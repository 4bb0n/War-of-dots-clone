const express = require('express');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server);
const port = process.env.PORT || 3000;
const fs = require('fs');
const { Game, Unit, City } = require('./game.js');

// --- Express Routes ---
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/home.html');
});
app.get('/gamepage', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});
app.get('/gameCreator.html', (req, res) => {
    res.sendFile(__dirname + '/public/gameCreator.html');
});

app.use(express.static(__dirname + '/public'));

app.get('/game.js', (req, res) => {
    res.sendFile(__dirname + '/game.js');
});

app.get('/maps', (req, res) => {
    fs.readdir(__dirname, (err, files) => {
        if (err) return res.status(500).json({ error: 'Could not list maps' });
        const mapFiles = files.filter(file => file.endsWith('.json'));
        res.json(mapFiles);
    });
});

// --- Game State Management ---
let publicGameQueue = []; // Holds socket IDs of players waiting for a public game
const activeGames = {}; // Holds all active games, keyed by a unique game ID

function generateGameId() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

// Collision detection helper functions
function getDistance(unit1, unit2) {
    const dx = unit1.x - unit2.x;
    const dy = unit1.y - unit2.y;
    return Math.sqrt(dx * dx + dy * dy);
}

function areUnitsColliding(unit1, unit2) {
    const distance = getDistance(unit1, unit2);
    return distance < (unit1.radius + unit2.radius);
}

function resolveCollision(unit1, unit2) {
    // Handle teammate collision (soft collision) - same as before
    if (unit1.team === unit2.team) {
        const dx = unit2.x - unit1.x;
        const dy = unit2.y - unit1.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance === 0) {
            const angle = Math.random() * Math.PI * 2;
            unit1.x += Math.cos(angle) * (unit1.radius + unit2.radius) * 0.5;
            unit1.y += Math.sin(angle) * (unit1.radius + unit2.radius) * 0.5;
            unit2.x -= Math.cos(angle) * (unit1.radius + unit2.radius) * 0.5;
            unit2.y -= Math.sin(angle) * (unit1.radius + unit2.radius) * 0.5;
            return;
        }
        
        const overlap = (unit1.radius + unit2.radius) - distance;
        if (overlap > 0) {
            const nx = dx / distance;
            const ny = dy / distance;
            const separation = overlap * 0.3;
            unit1.x -= nx * separation;
            unit1.y -= ny * separation;
            unit2.x += nx * separation;
            unit2.y += ny * separation;
        }
        return;
    }

    // Enemy collision (hard collision with combat)
    if (!unit1.storedPath && unit1.path && unit1.path.length > 0) {
        unit1.storedPath = [...unit1.path];
    }
    if (!unit2.storedPath && unit2.path && unit2.path.length > 0) {
        unit2.storedPath = [...unit2.path];
    }
    
    unit1.path = [];
    unit2.path = [];
    
    const shakeIntensity = 1;
    unit1.shakeX = (Math.random() - 0.5) * shakeIntensity;
    unit1.shakeY = (Math.random() - 0.5) * shakeIntensity;
    unit2.shakeX = (Math.random() - 0.5) * shakeIntensity;
    unit2.shakeY = (Math.random() - 0.5) * shakeIntensity;
    
    unit1.isFighting = true;
    unit2.isFighting = true;
    
    unit1.fightTimer = 60;
    unit2.fightTimer = 60;
    
    // NEW: Health-based damage system
    const healthDifference = unit1.health - unit2.health;
    const maxHealthBonus = 0.5; // Maximum bonus damage based on health difference
    
    // Calculate damage multipliers based on health advantage
    let unit1DamageMultiplier = 1.0;
    let unit2DamageMultiplier = 1.0;
    
    if (healthDifference > 0) {
        // Unit1 has more health, gets damage bonus
        const healthAdvantage = Math.min(healthDifference / 1000, 1.0); // Normalize to 0-1 range
        unit1DamageMultiplier = 1.0 + (healthAdvantage * maxHealthBonus);
    } else if (healthDifference < 0) {
        // Unit2 has more health, gets damage bonus
        const healthAdvantage = Math.min(Math.abs(healthDifference) / 1000, 1.0);
        unit2DamageMultiplier = 1.0 + (healthAdvantage * maxHealthBonus);
    }
    
    // Apply damage with health-based multipliers
    const unit1ActualDamage = unit1.attackDamage * unit1DamageMultiplier;
    const unit2ActualDamage = unit2.attackDamage * unit2DamageMultiplier;
    
    unit1.health -= unit2ActualDamage;
    unit2.health -= unit1ActualDamage;
    
    if (unit1.health <= 0) {
        unit1.isDead = true;
    }
    if (unit2.health <= 0) {
        unit2.isDead = true;
    }
}

function handleCollisions(units) {
    // First, update fighting timers and reset shake for all units
    units.forEach(unit => {
        if (unit.fightTimer > 0) {
            unit.fightTimer--;
            if (unit.fightTimer === 0) {
                unit.isFighting = false;
                unit.shakeX = 0;
                unit.shakeY = 0;
                
                // Restore the original path after fighting ends
                if (unit.storedPath && unit.storedPath.length > 0 && !unit.isDead) {
                    unit.path = [...unit.storedPath]; // Restore the stored path
                    unit.storedPath = null; // Clear the stored path
                }
            }
        }
    });
    
    // Check if units are still actually colliding with enemies
    // If not, end the fight early
    units.forEach(unit => {
        if (unit.isFighting && unit.fightTimer > 0) {
            let stillFighting = false;
            
            // Check if this unit is still colliding with any enemy
            for (let otherUnit of units) {
                if (otherUnit.team !== unit.team && !otherUnit.isDead && areUnitsColliding(unit, otherUnit)) {
                    stillFighting = true;
                    break;
                }
            }
            
            // If no longer fighting any enemies, end combat immediately
            if (!stillFighting) {
                unit.isFighting = false;
                unit.fightTimer = 0;
                unit.shakeX = 0;
                unit.shakeY = 0;
                
                // Restore the original path
                if (unit.storedPath && unit.storedPath.length > 0) {
                    unit.path = [...unit.storedPath];
                    unit.storedPath = null;
                }
            }
        }
    });
    
    // Check collisions between all unit pairs
    for (let i = 0; i < units.length; i++) {
        for (let j = i + 1; j < units.length; j++) {
            const unit1 = units[i];
            const unit2 = units[j];
            
            if (areUnitsColliding(unit1, unit2)) {
                resolveCollision(unit1, unit2);
            }
        }
    }
}

function removeDeadUnits(game) {
    game.redUnits = game.redUnits.filter(unit => !unit.isDead);
    game.blueUnits = game.blueUnits.filter(unit => !unit.isDead);
}

function updateBorder(game) {
    // Initialize territory grid if it doesn't exist
    if (!game.territoryGrid) {
        initializeTerritoryGrid(game);
    }
    
    // Update territory based on unit positions
    updateTerritoryControl(game);
    
    // Calculate border based on territory ownership
    calculateBorderFromTerritory(game);
}

function initializeTerritoryGrid(game) {
    const GRID_SIZE = 20; // Size of each territory cell
    const WIDTH = Math.ceil(1000 / GRID_SIZE); // Assuming 1000px wide map
    const HEIGHT = Math.ceil(600 / GRID_SIZE);  // Assuming 600px tall map
    
    game.territoryGrid = [];
    game.GRID_SIZE = GRID_SIZE;
    game.GRID_WIDTH = WIDTH;
    game.GRID_HEIGHT = HEIGHT;
    
    // Initialize grid - 0 = neutral, 1 = red, 2 = blue
    for (let y = 0; y < HEIGHT; y++) {
        game.territoryGrid[y] = [];
        for (let x = 0; x < WIDTH; x++) {
            // Start with smaller initial team areas, closer to the middle
            const centerX = WIDTH / 2; // Middle of the map (grid coordinate)
            
            if (x < centerX - 2) {
                game.territoryGrid[y][x] = 1; // Red starting area (left of center)
            } else if (x > centerX + 2) {
                game.territoryGrid[y][x] = 2; // Blue starting area (right of center)
            } else {
                game.territoryGrid[y][x] = 0; // Neutral middle area (4 grid cells wide)
            }
        }
    }
}

function updateTerritoryControl(game) {
    const allUnits = [...game.redUnits, ...game.blueUnits];
    const CAPTURE_RADIUS = 30; // How far around a unit captures territory
    
    allUnits.forEach(unit => {
        const teamValue = unit.team === 'red' ? 1 : 2;
        
        // Calculate grid position of unit
        const centerGridX = Math.floor(unit.x / game.GRID_SIZE);
        const centerGridY = Math.floor(unit.y / game.GRID_SIZE);
        
        // Capture territory in a radius around the unit
        const gridRadius = Math.ceil(CAPTURE_RADIUS / game.GRID_SIZE);
        
        for (let dy = -gridRadius; dy <= gridRadius; dy++) {
            for (let dx = -gridRadius; dx <= gridRadius; dx++) {
                const gridX = centerGridX + dx;
                const gridY = centerGridY + dy;
                
                // Check if within map bounds
                if (gridX >= 0 && gridX < game.GRID_WIDTH && 
                    gridY >= 0 && gridY < game.GRID_HEIGHT) {
                    
                    // Check if within capture radius
                    const worldX = gridX * game.GRID_SIZE + game.GRID_SIZE / 2;
                    const worldY = gridY * game.GRID_SIZE + game.GRID_SIZE / 2;
                    const distance = Math.sqrt(
                        Math.pow(unit.x - worldX, 2) + 
                        Math.pow(unit.y - worldY, 2)
                    );
                    
                    if (distance <= CAPTURE_RADIUS) {
                        // Capture this territory cell
                        game.territoryGrid[gridY][gridX] = teamValue;
                    }
                }
            }
        }
    });
}
function handleTerritoryEncirclement(game) {
    const allUnits = [...game.redUnits, ...game.blueUnits];
    
    // For each team, find connected territory regions
    handleTeamEncirclement(game, allUnits, 'red', 1);
    handleTeamEncirclement(game, allUnits, 'blue', 2);
}

function handleTeamEncirclement(game, allUnits, teamName, teamValue) {
    // Find all cells controlled by this team
    const teamCells = [];
    for (let y = 0; y < game.GRID_HEIGHT; y++) {
        for (let x = 0; x < game.GRID_WIDTH; x++) {
            if (game.territoryGrid[y][x] === teamValue) {
                teamCells.push({ x, y });
            }
        }
    }
    
    if (teamCells.length === 0) return;
    
    // Find cells that are connected to friendly units
    const connectedCells = new Set();
    const teamUnits = allUnits.filter(unit => unit.team === teamName);
    
    // Start flood fill from each unit position
    teamUnits.forEach(unit => {
        const unitGridX = Math.floor(unit.x / game.GRID_SIZE);
        const unitGridY = Math.floor(unit.y / game.GRID_SIZE);
        
        // Flood fill from this unit's position to mark all connected territory
        floodFillConnected(game, unitGridX, unitGridY, teamValue, connectedCells);
    });
    
    // Any team territory not in connectedCells is encircled - convert it to enemy
    const enemyTeamValue = teamValue === 1 ? 2 : 1;
    
    teamCells.forEach(cell => {
        const cellKey = `${cell.x},${cell.y}`;
        if (!connectedCells.has(cellKey)) {
            // This territory is encircled - convert to enemy control
            game.territoryGrid[cell.y][cell.x] = enemyTeamValue;
        }
    });
}

function floodFillConnected(game, startX, startY, teamValue, connectedCells) {
    const queue = [{ x: startX, y: startY }];
    const visited = new Set();
    
    while (queue.length > 0) {
        const current = queue.shift();
        const cellKey = `${current.x},${current.y}`;
        
        // Skip if already visited or out of bounds
        if (visited.has(cellKey) || 
            current.x < 0 || current.x >= game.GRID_WIDTH ||
            current.y < 0 || current.y >= game.GRID_HEIGHT) {
            continue;
        }
        
        visited.add(cellKey);
        
        // Skip if this cell doesn't belong to our team
        if (game.territoryGrid[current.y][current.x] !== teamValue) {
            continue;
        }
        
        // Mark this cell as connected
        connectedCells.add(cellKey);
        
        // Add adjacent cells to queue (4-directional connectivity)
        queue.push({ x: current.x + 1, y: current.y });
        queue.push({ x: current.x - 1, y: current.y });
        queue.push({ x: current.x, y: current.y + 1 });
        queue.push({ x: current.x, y: current.y - 1 });
    }
}

function calculateBorderFromTerritory(game) {
    // Instead of a single border line, we need to find all territory boundaries
    // This will create multiple border segments for pockets
    
    const borderSegments = [];
    
    // Find all horizontal boundaries (red-blue transitions)
    for (let y = 0; y < game.GRID_HEIGHT; y++) {
        const segments = [];
        let currentSegment = null;
        
        for (let x = 0; x < game.GRID_WIDTH - 1; x++) {
            const currentCell = game.territoryGrid[y][x];
            const nextCell = game.territoryGrid[y][x + 1];
            
            // Found a territory boundary
            if (currentCell !== nextCell && currentCell !== 0 && nextCell !== 0) {
                const worldX = (x + 1) * game.GRID_SIZE;
                const worldY = y * game.GRID_SIZE + game.GRID_SIZE / 2;
                
                segments.push({
                    x: worldX,
                    y: worldY,
                    leftTeam: currentCell,
                    rightTeam: nextCell
                });
            }
        }
        
        borderSegments.push(segments);
    }
    
    // Convert segments back to border points for the main border line
    // We'll use the leftmost red-blue or blue-red boundary as the main border
    game.borderPoints.forEach((borderPoint, index) => {
        const segmentsAtThisY = borderSegments[Math.floor(index * game.GRID_HEIGHT / game.borderPoints.length)];
        
        if (segmentsAtThisY && segmentsAtThisY.length > 0) {
            // Find the main boundary (closest to center or leftmost significant boundary)
            let mainBoundary = segmentsAtThisY[0];
            
            // If multiple boundaries, prefer the one closest to center (500px)
            if (segmentsAtThisY.length > 1) {
                mainBoundary = segmentsAtThisY.reduce((closest, current) => {
                    return Math.abs(current.x - 500) < Math.abs(closest.x - 500) ? current : closest;
                });
            }
            
            borderPoint.x = mainBoundary.x;
        } else {
            // No boundaries found, keep current position or default to center
            if (!borderPoint.x) borderPoint.x = 500;
        }
    });
    
    // Store all boundary segments for client-side pocket rendering
    game.allBoundaries = borderSegments;
}

function checkCityCaptures(game) {
    const allUnits = [...game.redUnits, ...game.blueUnits];
    const allCities = [...game.redCities, ...game.blueCities];
    const CAPTURE_DISTANCE = 25; // How close a unit needs to be to capture a city
    
    allCities.forEach(city => {
        // Find enemy units near this city
        const enemyUnits = allUnits.filter(unit => {
            if (unit.team === city.team) return false; // Skip friendly units
            
            const distance = Math.sqrt(
                Math.pow(unit.x - city.x, 2) + 
                Math.pow(unit.y - city.y, 2)
            );
            
            return distance <= CAPTURE_DISTANCE;
        });
        
        // If there are enemy units near the city and no friendly units defending
        if (enemyUnits.length > 0) {
            const friendlyUnits = allUnits.filter(unit => {
                if (unit.team !== city.team) return false; // Skip enemy units
                
                const distance = Math.sqrt(
                    Math.pow(unit.x - city.x, 2) + 
                    Math.pow(unit.y - city.y, 2)
                );
                
                return distance <= CAPTURE_DISTANCE;
            });
            
            // City is captured if enemies outnumber defenders
            if (enemyUnits.length > friendlyUnits.length) {
                const capturingTeam = enemyUnits[0].team;
                
                console.log(`City at (${city.x}, ${city.y}) captured by ${capturingTeam}!`);
                
                // Change city allegiance
                const oldTeam = city.team;
                city.team = capturingTeam;
                
                // Move city to the correct array
                if (capturingTeam === 'red') {
                    // Remove from blue cities, add to red cities
                    const cityIndex = game.blueCities.indexOf(city);
                    if (cityIndex > -1) {
                        game.blueCities.splice(cityIndex, 1);
                        game.redCities.push(city);
                    }
                } else {
                    // Remove from red cities, add to blue cities
                    const cityIndex = game.redCities.indexOf(city);
                    if (cityIndex > -1) {
                        game.redCities.splice(cityIndex, 1);
                        game.blueCities.push(city);
                    }
                }
                
                // Reset spawn timer and count for new owner
                city.spawnInterval = 1500;
                city.spawnCount = 0;
                
                // Optional: Add capture effect
                city.justCaptured = true;
                city.captureEffectTimer = 60; // Show capture effect for 60 frames
            }
        }
    });
}

// Update city visual effects
function updateCityEffects(game) {
    const allCities = [...game.redCities, ...game.blueCities];
    
    allCities.forEach(city => {
        if (city.captureEffectTimer > 0) {
            city.captureEffectTimer--;
            if (city.captureEffectTimer === 0) {
                city.justCaptured = false;
            }
        }
    });
}

// --- Socket.IO Connection Handling ---
io.on('connection', (socket) => {
    console.log('a player connected:', socket.id);

    socket.on('findGame', () => {
        console.log(`Player ${socket.id} is searching for a public game.`);
        searchForPublicGame(socket);
    });

    socket.on('createGame', (options) => {
        const gameId = generateGameId();
        const game = new Game(socket.id);
        game.id = gameId;
        game.map = options.map || 'default.json';
        activeGames[gameId] = game;

        socket.join(gameId);
        socket.gameId = gameId; // Associate gameId with the socket
        console.log(`Player ${socket.id} created game ${gameId} with map ${game.map}`);
        socket.emit('gameCreated', { gameId });
    });

    socket.on('joinGame', (gameId) => {
        const game = activeGames[gameId];
        if (game && game.teamBlue === null) {
            game.joinGame(socket.id);
            socket.join(gameId);
            socket.gameId = gameId; // Associate gameId with the socket
            console.log(`Player ${socket.id} joined game ${gameId}`);
            startGame(game);
        } else {
            socket.emit('joinError', 'Game not found or is full.');
        }
    });

    socket.on('disconnect', () => {
        console.log('a player disconnected:', socket.id);

        // If player was in the public queue, remove them
        publicGameQueue = publicGameQueue.filter(id => id !== socket.id);

        // If player was in a game, end the game
        const gameId = socket.gameId;
        if (gameId && activeGames[gameId] && activeGames[gameId].canDelete) {
            const game = activeGames[gameId];
            const opponentId = game.teamRed === socket.id ? game.teamBlue : game.teamRed;
            if (opponentId) {
                io.to(opponentId).emit('gameComplete', { win: true });
            }
            console.log(`Game ${gameId} ended due to disconnect.`);
            delete activeGames[gameId];
        }
    });

    // --- In-Game Actions ---
    socket.on('unitMove', (data) => {
        const gameId = socket.gameId;
        const game = activeGames[gameId];

        if (game) {
            // Find the correct unit in the server's state and set its path
            const allUnits = [...game.redUnits, ...game.blueUnits];
            data.unitIds.forEach(unitId => {
                const unit = allUnits.find(u => u.id === unitId);
                if (unit) {
                    // Allow movement override even during combat
                    unit.setPath(data.path);
                    
                    // If unit was fighting, clear stored path and fighting state
                    if (unit.isFighting) {
                        unit.storedPath = null; // Clear any stored path
                        unit.isFighting = false;
                        unit.fightTimer = 0;
                        unit.shakeX = 0;
                        unit.shakeY = 0;
                    }
                }
            });
        }
    });

    socket.on('reconnectPlayer', (oldSocketId) => {
        console.log(`Player ${socket.id} is attempting to reconnect for ${oldSocketId}`);
        for (const gameId in activeGames) {
            const game = activeGames[gameId];
            if (game.teamRed === oldSocketId) {
                // This player is red team. Update their socket ID.
                game.teamRed = socket.id;
                socket.gameId = gameId;
                socket.join(gameId);
                console.log(`Reconnected player ${oldSocketId} as ${socket.id} in game ${gameId}`);
                // Now send them the game start data.
                const initialGameState = { units: [...game.redUnits, ...game.blueUnits], cities: [...game.redCities, ...game.blueCities] };
                socket.emit('gameStart', { team: 'red', ...initialGameState });

            } else if (game.teamBlue === oldSocketId) {
                // This player is blue team. Update their socket ID.
                game.teamBlue = socket.id;
                socket.gameId = gameId;
                socket.join(gameId);
                console.log(`Reconnected player ${oldSocketId} as ${socket.id} in game ${gameId}`);
                // Now send them the game start data.
                const initialGameState = { units: [...game.redUnits, ...game.blueUnits], cities: [...game.redCities, ...game.blueCities] };
                socket.emit('gameStart', { team: 'blue', ...initialGameState });
            }
        }
    });
});

// --- Game Logic Functions ---
function searchForPublicGame(socket) {
    if (publicGameQueue.length > 0) {
        // Match found
        const opponentSocketId = publicGameQueue.shift();
        const opponentSocket = io.sockets.sockets.get(opponentSocketId);

        if (opponentSocket) {
            const gameId = generateGameId();
            const game = new Game(opponentSocketId, socket.id); // teamRed, teamBlue
            game.id = gameId;
            game.map = 'default.json'; // Public games use the default map
            activeGames[gameId] = game;

            socket.join(gameId);
            opponentSocket.join(gameId);
            socket.gameId = gameId;
            opponentSocket.gameId = gameId;

            console.log(`Starting public game ${gameId} between ${opponentSocketId} and ${socket.id}`);
            startGame(game);
        } else {
            // Opponent disconnected before match, put current player in queue
            publicGameQueue.push(socket.id);
        }
    } else {
        // No match found, add to queue
        publicGameQueue.push(socket.id);
    }
}

function startGame(game) {
    // IMPORTANT: Reset/clear any previous game state
    game.redUnits = [];
    game.blueUnits = [];
    game.redCities = [];
    game.blueCities = [];
    game.territoryGrid = null; // Force territory grid to be reinitialized

    game.borderPoints = [];
    const BORDER_RESOLUTION = 15;
    for (let y = 0; y <= 600; y += BORDER_RESOLUTION) {
        game.borderPoints.push({ x: 500, y: y, targetX: 500 });
    }
    
    let mapToLoad = game.map || 'default.json';
    let gameMapData;
    try {
        const mapData = fs.readFileSync(mapToLoad, 'utf8');
        gameMapData = JSON.parse(mapData);
        console.log(`Map '${mapToLoad}' loaded for game ${game.id}.`);
    } catch (err) {
        console.error(`Could not load map '${mapToLoad}'. Using default setup.`, err);
        gameMapData = null;
    }

    if (gameMapData) {
        // Load from map file
        gameMapData.cities.forEach(cityData => {
            const newCity = new City(cityData.x, cityData.y, cityData.team);
            if (cityData.team === 'red') game.redCities.push(newCity);
            else game.blueCities.push(newCity);
        });

        if (gameMapData.units) {
            gameMapData.units.forEach(unitData => {
                const newUnit = new Unit(unitData.x, unitData.y, unitData.team, unitData.type);
                if (unitData.team === 'red') game.redUnits.push(newUnit);
                else game.blueUnits.push(newUnit);
            });
        }

        if (gameMapData.territoryGrid) {
            game.territoryGrid = gameMapData.territoryGrid.map(row => [...row]);
        } else {
            game.territoryGrid = null;
        }
        
        game.GRID_SIZE = 20;
        game.GRID_WIDTH = 1000 / 20;
        game.GRID_HEIGHT = 600 / 20;
    } else {
        // Fallback to default setup
        console.log("Using default game setup.");
        game.blueCities = [new City(900, 100, "blue"), new City(900, 300, "blue"), new City(900, 500, "blue")];
        game.redCities = [new City(50, 100, "red"), new City(50, 300, "red"), new City(50, 500, "red")];
        game.territoryGrid = null;
    }

        io.to(game.teamRed).emit('gameReady', { socketId: game.teamRed });
    io.to(game.teamBlue).emit('gameReady', { socketId: game.teamBlue });
    
    // Start the game
    game.startGame();
    
    // CRITICAL FIX: Send gameStart to individual sockets, not rooms
    const initialGameState = {
        units: [...game.redUnits, ...game.blueUnits],
        cities: [...game.redCities, ...game.blueCities],
        border: game.borderPoints
    };
    
    console.log(`Sending gameStart to both players in game ${game.id}`);
    console.log(`Red player socket: ${game.teamRed}`);
    console.log(`Blue player socket: ${game.teamBlue}`);
    
    // Get the actual socket objects and emit directly to them
    const redSocket = io.sockets.sockets.get(game.teamRed);
    const blueSocket = io.sockets.sockets.get(game.teamBlue);
    
    if (redSocket) {
        redSocket.emit('gameStart', { team: 'red', ...initialGameState });
        console.log('gameStart sent to red player');
    } else {
        console.error('Red player socket not found!');
    }
    
    if (blueSocket) {
        blueSocket.emit('gameStart', { team: 'blue', ...initialGameState });
        console.log('gameStart sent to blue player');
    } else {
        console.error('Blue player socket not found!');
    }
}
server.listen(port, () => {
    console.log('Server listening at port %d', port);
});

// Server-side game loop with collision detection
function updateGame(game) {
    if (!game.started) return;

    let allUnits = [...game.redUnits, ...game.blueUnits];
    
    // Update unit positions
    allUnits.forEach(unit => {
        unit.update();

        if(unit.health < unit.maxHealth && !unit.isFighting){
            unit.health += 1;
        }
        
        // Apply shake effect if fighting
        if (unit.isFighting && unit.fightTimer > 0) {
            const shakeIntensity = 1.5;
            unit.shakeX = (Math.random() - 0.5) * shakeIntensity;
            unit.shakeY = (Math.random() - 0.5) * shakeIntensity;
        } else {
            unit.shakeX = 0;
            unit.shakeY = 0;
        }
    });

    // Update cities and spawn units
    const allCities = [...game.redCities, ...game.blueCities];
    allCities.forEach(city => {
        city.update();
        if (city.spawnInterval === 0) {
            city.spawnInterval = 2000;
            const team = city.team;
            const unitType = city.spawnCount < 3 ? "infantry" : "tank";
            if (city.spawnCount < 3) city.spawnCount += 1;
            else city.spawnCount = 0;
            const newUnit = new Unit(city.x, city.y, team, unitType);
            
            if (team === 'red') {
                game.redUnits.push(newUnit);
            } else {
                game.blueUnits.push(newUnit);
            }
        }
    });

    // Check for city captures
    checkCityCaptures(game);
    
    // Update city effects
    updateCityEffects(game);
    
    // Update the border based on unit positions
    updateBorder(game);
    
    // NEW: Handle territory encirclement after territory updates
    handleTerritoryEncirclement(game);

    // Handle collisions after movement
    handleCollisions(allUnits);
    
    // Remove dead units and update the allUnits array for broadcasting
    game.redUnits = game.redUnits.filter(unit => !unit.isDead);
    game.blueUnits = game.blueUnits.filter(unit => !unit.isDead);
    allUnits = [...game.redUnits, ...game.blueUnits];
    
    // Broadcast the new state to all players in the game
    const gameState = { 
        units: allUnits, 
        cities: allCities, 
        border: game.borderPoints,
        territoryGrid: game.territoryGrid,
        allBoundaries: game.allBoundaries
    };
    io.to(game.id).emit('gameStateUpdate', gameState);
}

const TICK_RATE = 30;
setInterval(() => {
    Object.values(activeGames).forEach(updateGame);
}, 1000 / TICK_RATE);
