const express = require('express');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server);
const port = process.env.PORT || 3000;
const fs = require('fs');
const { Game, Unit, City } = require('./game.js');

app.use(express.static(__dirname + '/public'));

// Serve game.js to the client
app.get('/game.js', (req, res) => {
    res.sendFile(__dirname + '/game.js');
});
let customMap;
try {
    const mapData = fs.readFileSync('stalingrad.json', 'utf8');
    customMap = JSON.parse(mapData);
    console.log("Custom map loaded successfully.");
} catch (err) {
    console.error("Could not load custom_map.json. Using default map.", err);
    customMap = null; // Fallback to default if no map is found
}

const games = []

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
    // Handle teammate collision (soft collision)
    if (unit1.team === unit2.team) {
        // Soft collision for teammates - just push them apart gently
        const dx = unit2.x - unit1.x;
        const dy = unit2.y - unit1.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance === 0) {
            // Units are on exactly the same position, push them apart randomly
            const angle = Math.random() * Math.PI * 2;
            unit1.x += Math.cos(angle) * (unit1.radius + unit2.radius) * 0.5;
            unit1.y += Math.sin(angle) * (unit1.radius + unit2.radius) * 0.5;
            unit2.x -= Math.cos(angle) * (unit1.radius + unit2.radius) * 0.5;
            unit2.y -= Math.sin(angle) * (unit1.radius + unit2.radius) * 0.5;
            return;
        }
        
        // Calculate gentle separation for teammates
        const overlap = (unit1.radius + unit2.radius) - distance;
        if (overlap > 0) {
            const nx = dx / distance;
            const ny = dy / distance;
            
            // Gentle separation - only push apart by a small amount
            const separation = overlap * 0.3; // Much gentler than enemy collision
            unit1.x -= nx * separation;
            unit1.y -= ny * separation;
            unit2.x += nx * separation;
            unit2.y += ny * separation;
        }
        return; // Don't proceed with combat logic for teammates
    }

    // Enemy collision (hard collision with combat)
    // Store the original paths before stopping units (only if not already stored)
    if (!unit1.storedPath && unit1.path && unit1.path.length > 0) {
        unit1.storedPath = [...unit1.path]; // Make a copy of the path
    }
    if (!unit2.storedPath && unit2.path && unit2.path.length > 0) {
        unit2.storedPath = [...unit2.path]; // Make a copy of the path
    }
    
    // Stop both units by clearing their current paths
    unit1.path = [];
    unit2.path = [];
    
    // Add shake effect
    const shakeIntensity = 1;
    unit1.shakeX = (Math.random() - 0.5) * shakeIntensity;
    unit1.shakeY = (Math.random() - 0.5) * shakeIntensity;
    unit2.shakeX = (Math.random() - 0.5) * shakeIntensity;
    unit2.shakeY = (Math.random() - 0.5) * shakeIntensity;
    
    // Mark units as fighting
    unit1.isFighting = true;
    unit2.isFighting = true;
    
    // Reset fighting timer
    unit1.fightTimer = 60; // frames
    unit2.fightTimer = 60; // frames
    
    // Apply damage each frame they're colliding
    const damagePerFrame = 1;
    unit1.health -= damagePerFrame;
    unit2.health -= damagePerFrame;
    
    // Mark units as dead if health drops to 0 or below
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

// Optional combat system
function handleCombat(unit1, unit2) {
    // Simple combat: reduce health of both units
    unit1.health -= unit2.attackDamage;
    unit2.health -= unit1.attackDamage;
    
    // Remove dead units (this would need to be handled more carefully in a real game)
    if (unit1.health <= 0) {
        unit1.isDead = true;
    }
    if (unit2.health <= 0) {
        unit2.isDead = true;
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
                city.spawnInterval = 1000;
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

io.on('connection', (socket) => {
    console.log('a player connected:', socket.id);
    searchGame(socket.id);

    socket.on('unitMove', (data) => {
        const game = games.find(g => g.teamRed === socket.id || g.teamBlue === socket.id);
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
    
    socket.on('disconnect', () => {
        for (let i = 0; i < games.length; i++){
            if (games[i].teamBlue === socket.id || games[i].teamRed === socket.id){
                games.splice(i, 1)
            }
        }
        console.log('a player disconnected:', socket.id);
    });
});

function searchGame(id){
    for (let i = 0; i < games.length; i++){
        if (games[i].teamBlue === null){
            games[i].joinGame(id)
            startGame(games[i]);
            return;
        }
    }

    // If no open games are found, create a new one for the player.
    games.push(new Game(id));
}

function startGame(game) {
    if (customMap) {
        // --- LOAD FROM CUSTOM MAP ---
        
        // Load cities from the map file
        customMap.cities.forEach(cityData => {
            const newCity = new City(cityData.x, cityData.y, cityData.team);
            if (cityData.team === 'red') game.redCities.push(newCity);
            else game.blueCities.push(newCity);
        });

        // Load pre-placed units from the map file (NEW)
        if (customMap.units) {
            customMap.units.forEach(unitData => {
                const newUnit = new Unit(unitData.x, unitData.y, unitData.team, unitData.type);
                if (unitData.team === 'red') game.redUnits.push(newUnit);
                else game.blueUnits.push(newUnit);
            });
        }

        // Initialize territory from the map file
        game.territoryGrid = customMap.territoryGrid;
        game.GRID_SIZE = 20;
        game.GRID_WIDTH = 1000 / 20;
        game.GRID_HEIGHT = 600 / 20;

    } else {
        // --- FALLBACK TO ORIGINAL HARDCODED SETUP ---
        console.log("No custom map found, using default game setup.");
        for(let i = 0; i < 10; i++){
            game.redUnits.push(new Unit(100, Math.random() * 600, "red"));
            game.blueUnits.push(new Unit(800, Math.random() * 600, "blue"));
        }
        for(let i = 0; i < 5; i++){
            game.redUnits.push(new Unit(100, Math.random() * 600, "red", "tank"));
            game.blueUnits.push(new Unit(800, Math.random() * 600, "blue", "tank"));
        }
        game.blueCities = [new City(900, 100, "blue"), new City(900, 300, "blue"), new City(900, 500, "blue")];
        game.redCities = [new City(50, 100, "red"), new City(50, 300, "red"), new City(50, 500, "red")];
    }

    // NOTE: The old logic for spawning initial units at cities has been removed.
    // The map creator is now the single source of truth for the starting layout.

    io.to(game.teamRed).emit('gameStart', { team: 'red', units: [...game.redUnits, ...game.blueUnits], cities: [...game.redCities, ...game.blueCities] });
    io.to(game.teamBlue).emit('gameStart', { team: 'blue', units: [...game.redUnits, ...game.blueUnits], cities: [...game.redCities, ...game.blueCities] });
}

server.listen(port, () => {
    console.log('Server listening at port %d', port);
});

// Server-side game loop with collision detection
const TICK_RATE = 30;
setInterval(() => {
    games.forEach(game => {
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
                city.spawnInterval = 1000;
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
        io.to(game.teamRed).emit('gameStateUpdate', gameState);
        io.to(game.teamBlue).emit('gameStateUpdate', gameState);
    });
}, 1000 / TICK_RATE);