const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const socket = io();

let myTeam = '';
let units = [];
let selectedUnits = [];
let cities = [];
let border = [];
let currentPath = [];
let territoryGrid = null;
let allBoundaries = []; // To store all boundary data for pockets
let visibilityGrid = null; // For Fog of War
const GRID_SIZE = 20; // Must match server's GRID_SIZE
// Set canvas size to fill the window and prevent blurriness
function resizeCanvas() {
    // Get the actual displayed size of the canvas
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
}

window.addEventListener('resize', resizeCanvas, false);
resizeCanvas(); // Initial resize when the script loads

// On page load, check if we need to reconnect
const urlParams = new URLSearchParams(window.location.search);
const oldSocketId = urlParams.get('sid');
if (oldSocketId) {
    socket.emit('reconnectPlayer', oldSocketId);
}

socket.on("gameComplete", (data) => {
    console.log("Game complete event received:", data);
    units = [];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const message = data.win ? "You win!" : "You lose.";
    alert(`Game complete! ${message}`);
    setTimeout(() => {
        window.location.href = "/";
    }, 4000);
})

socket.on("gameStart", data => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    myTeam = data.team;
    console.log("My team:", myTeam); // Debug log to verify team assignment
    
    // Instead of recreating Unit instances, just use the data directly
    // This avoids issues with the Unit constructor overriding server data
    units = data.units.map(u => {
        // Add any methods that might be needed for client-side operations
        u.update = function() {
            if (this.path && this.path.length > 0) {
                const target = this.path[0];
                const dx = target.x - this.x;
                const dy = target.y - this.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
        
                if (distance < this.speed) {
                    this.x = target.x;
                    this.y = target.y;
                    this.path.shift();
                } else {
                    this.x += (dx / distance) * this.speed;
                    this.y += (dy / distance) * this.speed;
                }
            }
        };
        return u;
    });
    
    console.log("Units received from server:", units);
    console.log("Unit teams:", units.map(u => ({ id: u.id, team: u.team, x: u.x, y: u.y })));
    gameLoop();
    cities = data.cities;
    border = data.border;
});

socket.on('gameStateUpdate', (gameState) => {
    units = gameState.units;
    border = gameState.border;
    territoryGrid = gameState.territoryGrid;
    allBoundaries = gameState.allBoundaries; // Receive all boundary data for pockets

    gameState.cities.forEach(serverCity => {
        const clientCity = cities.find(c => c.id === serverCity.id);
        if (clientCity) {
            clientCity.x = serverCity.x;
            clientCity.y = serverCity.y;
        }
    });
});

let isLooping = false;

function drawCityCapturZone(city) {
    // Check if any units are near this city
    const nearbyUnits = units.filter(unit => {
        const distance = Math.sqrt(
            Math.pow(unit.x - city.x, 2) + 
            Math.pow(unit.y - city.y, 2)
        );
        return distance <= 25 && unit.team !== city.team; // Enemy units within capture range
    });
    
    if (nearbyUnits.length > 0) {
        // Draw capture zone
        ctx.beginPath();
        ctx.arc(city.x, city.y, 25, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 255, 0, 0.6)'; // Yellow warning
        ctx.lineWidth = 2;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.closePath();
        
        // Draw warning indicator
        const now = Date.now();
        const warningSize = 3 + Math.sin(now * 0.015) * 1;
        ctx.beginPath();
        ctx.arc(city.x, city.y - city.radius - 10, warningSize, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 0, 0.8)';
        ctx.fill();
        ctx.closePath();
    }
    
    // Also check for friendly units defending
    const defendingUnits = units.filter(unit => {
        const distance = Math.sqrt(
            Math.pow(unit.x - city.x, 2) + 
            Math.pow(unit.y - city.y, 2)
        );
        return distance <= 25 && unit.team === city.team; // Friendly units within range
    });
    
    if (defendingUnits.length > 0 && nearbyUnits.length > 0) {
        // Show defensive indicator
        ctx.beginPath();
        ctx.arc(city.x, city.y, 30, 0, Math.PI * 2);
        ctx.strokeStyle = city.team === 'red' ? 'rgba(255, 100, 100, 0.4)' : 'rgba(100, 100, 255, 0.4)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.closePath();
    }
}

function drawCity(city) {
    const now = Date.now();
    
    // Base city drawing is always done
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.arc(city.x, city.y, city.radius, 0, Math.PI * 2);
    ctx.fillStyle = city.team;
    ctx.fill();
    ctx.closePath();
    ctx.globalAlpha = 1;
    
    // Draw city border
    ctx.beginPath();
    ctx.arc(city.x, city.y, city.radius, 0, Math.PI * 2);
    ctx.strokeStyle = city.team === 'red' ? 'darkred' : 'darkblue';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.closePath();

    // FOG OF WAR CHECK for effects
    const gridX = Math.floor(city.x / GRID_SIZE);
    const gridY = Math.floor(city.y / GRID_SIZE);
    const isVisible = visibilityGrid && visibilityGrid[gridY] && visibilityGrid[gridY][gridX];

    if (!isVisible) return; // Don't draw effects if city is in fog
    
    // Draw capture effect if city was just captured
    if (city.justCaptured && city.captureEffectTimer > 0) {
        const effectIntensity = city.captureEffectTimer / 60; // Fade out over 60 frames
        
        // Pulsing capture ring
        const pulseSize = city.radius + 10 + Math.sin(now * 0.02) * 5;
        ctx.beginPath();
        ctx.arc(city.x, city.y, pulseSize, 0, Math.PI * 2);
        ctx.strokeStyle = city.team === 'red' ? `rgba(255, 100, 100, ${effectIntensity})` : `rgba(100, 100, 255, ${effectIntensity})`;
        ctx.lineWidth = 3;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.closePath();
        
        // Inner glow effect
        const gradient = ctx.createRadialGradient(city.x, city.y, 0, city.x, city.y, city.radius + 15);
        gradient.addColorStop(0, city.team === 'red' ? `rgba(255, 150, 150, ${effectIntensity * 0.3})` : `rgba(150, 150, 255, ${effectIntensity * 0.3})`);
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        
        ctx.beginPath();
        ctx.arc(city.x, city.y, city.radius + 15, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();
        ctx.closePath();
    }
    
    // Draw production indicator (small dots showing spawn progress)
    const spawnProgress = 1 - (city.spawnInterval / 1000);
    if (spawnProgress > 0.1) {
        const indicatorAngle = spawnProgress * Math.PI * 2 - Math.PI / 2; // Start from top
        const indicatorX = city.x + Math.cos(indicatorAngle) * (city.radius + 5);
        const indicatorY = city.y + Math.sin(indicatorAngle) * (city.radius + 5);
        
        ctx.beginPath();
        ctx.arc(indicatorX, indicatorY, 2, 0, Math.PI * 2);
        ctx.fillStyle = city.team === 'red' ? 'rgba(255, 200, 200, 0.8)' : 'rgba(200, 200, 255, 0.8)';
        ctx.fill();
        ctx.closePath();
    }
    
    // Draw capture zone indicator when units are nearby
    drawCityCapturZone(city);
}

function calculateVisibilityGrid() {
    if (!territoryGrid) return;

    const GRID_WIDTH = territoryGrid[0].length;
    const GRID_HEIGHT = territoryGrid.length;
    const SIGHT_RADIUS = 2; // 3 squares visibility

    visibilityGrid = Array(GRID_HEIGHT).fill(null).map(() => Array(GRID_WIDTH).fill(false));
    const teamValue = myTeam === 'red' ? 1 : 2;

    const setVisible = (centerX, centerY) => {
        for (let dy = -SIGHT_RADIUS; dy <= SIGHT_RADIUS; dy++) {
            for (let dx = -SIGHT_RADIUS; dx <= SIGHT_RADIUS; dx++) {
                const gridX = centerX + dx;
                const gridY = centerY + dy;
                if (gridX >= 0 && gridX < GRID_WIDTH && gridY >= 0 && gridY < GRID_HEIGHT) {
                    if (Math.sqrt(dx * dx + dy * dy) <= SIGHT_RADIUS) {
                        visibilityGrid[gridY][gridX] = true;
                    }
                }
            }
        }
    };

    for (let y = 0; y < GRID_HEIGHT; y++) {
        for (let x = 0; x < GRID_WIDTH; x++) {
            if (territoryGrid[y][x] === teamValue) setVisible(x, y);
        }
    }

    units.filter(u => u.team === myTeam).forEach(unit => {
        setVisible(Math.floor(unit.x / GRID_SIZE), Math.floor(unit.y / GRID_SIZE));
    });
}

function drawBorder(borderPoints) {
    if (!borderPoints || borderPoints.length < 2) return;
    
    // Draw captured territories first (this shows the pockets)
    drawCapturedTerritory();
    
    // Draw all territory boundaries (including pocket boundaries)
    drawAllTerritoryBoundaries();
    
    // Draw the main border line
    drawMainTerritoryBorder(borderPoints);
}

function drawCapturedTerritory() {
    if (!territoryGrid) return;
    
    ctx.save();
    
    // Draw territory cells - this automatically shows pockets
    for (let y = 0; y < territoryGrid.length; y++) {
        for (let x = 0; x < territoryGrid[y].length; x++) {
            // FOG OF WAR CHECK
            if (!visibilityGrid || !visibilityGrid[y][x]) {
                continue; // Don't draw territory in the fog
            }

            const cell = territoryGrid[y][x];
            const worldX = x * GRID_SIZE;
            const worldY = y * GRID_SIZE;
            
            if (cell === 1) {
                // Red territory
                ctx.fillStyle = 'rgba(255, 100, 100, 0.25)';
                ctx.fillRect(worldX, worldY, GRID_SIZE, GRID_SIZE);
            } else if (cell === 2) {
                // Blue territory  
                ctx.fillStyle = 'rgba(100, 100, 255, 0.25)';
                ctx.fillRect(worldX, worldY, GRID_SIZE, GRID_SIZE);
            }
            // Neutral territory (0) is not drawn
        }
    }
    
    ctx.restore();
}

function drawAllTerritoryBoundaries() {
    if (!allBoundaries) return;
    
    ctx.save();
    
    // Draw all boundary lines (including pocket boundaries)
    allBoundaries.forEach(segments => {
        segments.forEach(segment => {
            // Draw boundary markers
            ctx.beginPath();
            ctx.arc(segment.x, segment.y, 2, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.fill();
            
            // Draw a small vertical line to show the boundary
            ctx.beginPath();
            ctx.moveTo(segment.x, segment.y - 10);
            ctx.lineTo(segment.x, segment.y + 10);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
            ctx.lineWidth = 1;
            ctx.stroke();
        });
    });
    
    ctx.restore();
}

function drawMainTerritoryBorder(borderPoints) {
    ctx.save();
    
    // Draw the main border line (primary front line)
    ctx.beginPath();
    ctx.moveTo(borderPoints[0].x, borderPoints[0].y);
    
    for (let i = 1; i < borderPoints.length; i++) {
        ctx.lineTo(borderPoints[i].x, borderPoints[i].y);
    }
    
    // Style the main border differently from pocket boundaries
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 4;
    ctx.stroke();
    
    // Add a darker outline for the main border
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.lineWidth = 2;
    ctx.stroke();
    
    ctx.restore();
}

// Enhanced territory visualization with pocket highlighting
function drawTerritoryCells() {
    if (!territoryGrid) return;
    
    ctx.save();
    const GRID_SIZE = 20;
    
    // First pass: identify pocket cells
    const pocketCells = findPocketCells();
    
    // Draw territory cells with pocket highlighting
    for (let y = 0; y < territoryGrid.length; y++) {
        for (let x = 0; x < territoryGrid[y].length; x++) {
            const cell = territoryGrid[y][x];
            const worldX = x * GRID_SIZE;
            const worldY = y * GRID_SIZE;
            const isPocket = pocketCells.has(`${x},${y}`);
            
            if (cell === 1) {
                // Red territory - brighter if it's a pocket
                ctx.fillStyle = isPocket ? 'rgba(255, 100, 100, 0.4)' : 'rgba(255, 100, 100, 0.25)';
                ctx.fillRect(worldX, worldY, GRID_SIZE, GRID_SIZE);
                
                // Add border around pocket cells
                if (isPocket) {
                    ctx.strokeStyle = 'rgba(255, 50, 50, 0.8)';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(worldX, worldY, GRID_SIZE, GRID_SIZE);
                }
            } else if (cell === 2) {
                // Blue territory - brighter if it's a pocket
                ctx.fillStyle = isPocket ? 'rgba(100, 100, 255, 0.4)' : 'rgba(100, 100, 255, 0.25)';
                ctx.fillRect(worldX, worldY, GRID_SIZE, GRID_SIZE);
                
                // Add border around pocket cells
                if (isPocket) {
                    ctx.strokeStyle = 'rgba(50, 50, 255, 0.8)';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(worldX, worldY, GRID_SIZE, GRID_SIZE);
                }
            }
        }
    }
    
    ctx.restore();
}

function findPocketCells() {
    const pockets = new Set();
    if (!territoryGrid) return pockets;
    
    // Simple pocket detection: find cells that are surrounded by enemy territory
    for (let y = 1; y < territoryGrid.length - 1; y++) {
        for (let x = 1; x < territoryGrid[y].length - 1; x++) {
            const cell = territoryGrid[y][x];
            if (cell === 0) continue; // Skip neutral
            
            // Check if this cell is surrounded by enemy territory
            let enemyCount = 0;
            let totalNeighbors = 0;
            
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dy === 0) continue; // Skip self
                    
                    const neighbor = territoryGrid[y + dy][x + dx];
                    totalNeighbors++;
                    
                    if (neighbor !== 0 && neighbor !== cell) {
                        enemyCount++;
                    }
                }
            }
            
            // If more than half the neighbors are enemy territory, it's a pocket
            if (enemyCount > totalNeighbors * 0.5) {
                pockets.add(`${x},${y}`);
            }
        }
    }
    
    return pockets;
}

function drawPath(path) {
    if (path.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) {
        ctx.lineTo(path[i].x, path[i].y);
    }
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.closePath();
}

function drawFogOfWar() {
    if (!visibilityGrid) return;

    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = 'rgb(0, 0, 0)'; // Opaque black fog

    for (let y = 0; y < visibilityGrid.length; y++) {
        for (let x = 0; x < visibilityGrid[y].length; x++) {
            if (!visibilityGrid[y][x]) {
                ctx.fillRect(x * GRID_SIZE, y * GRID_SIZE, GRID_SIZE, GRID_SIZE);
            }
        }
    }
    ctx.restore();
}

function drawUnit(unit) {
    if (unit.isDead) return;

    // FOG OF WAR CHECK: Only draw enemy units if they are in a visible area
    if (unit.team !== myTeam && visibilityGrid) {
        const gridX = Math.floor(unit.x / GRID_SIZE);
        const gridY = Math.floor(unit.y / GRID_SIZE);
        if (!visibilityGrid || !visibilityGrid[gridY] || !visibilityGrid[gridY][gridX]) {
            return; // Don't draw enemy unit in the fog
        }
    }

    const displayX = unit.x + (unit.shakeX || 0);
    const displayY = unit.y + (unit.shakeY || 0);
    
    const isSelected = selectedUnits.some(selected => selected.id === unit.id);
    if (isSelected && unit.team === myTeam) {
        ctx.beginPath();
        ctx.arc(displayX, displayY, 30, 0, Math.PI * 2); // 30px capture radius
        ctx.strokeStyle = unit.team === 'red' ? 'rgba(255, 100, 100, 0.4)' : 'rgba(100, 100, 255, 0.4)';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
    }
    
    if (unit.isCutOff && unit.cutOffTimer > 0) {
        const now = Date.now();
        const pulseIntensity = Math.sin(now * 0.01) * 0.3 + 0.7;
        
        ctx.beginPath();
        ctx.arc(displayX, displayY, unit.radius + 12, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 165, 0, ${pulseIntensity})`;
        ctx.lineWidth = 3;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.closePath();
        
        ctx.strokeStyle = `rgba(255, 0, 0, ${pulseIntensity})`;
        ctx.lineWidth = 2;
        const iconSize = 4;
        const iconX = displayX;
        const iconY = displayY - unit.radius - 16;
        
        ctx.beginPath();
        ctx.moveTo(iconX - iconSize, iconY - iconSize);
        ctx.lineTo(iconX + iconSize, iconY + iconSize);
        ctx.moveTo(iconX + iconSize, iconY - iconSize);
        ctx.lineTo(iconX - iconSize, iconY + iconSize);
        ctx.stroke();
    }
    
    ctx.beginPath();
    ctx.arc(displayX, displayY, unit.radius, 0, Math.PI * 2);
    ctx.fillStyle = unit.team;
    ctx.fill();
    
    if (unit.type === "tank") {
        ctx.strokeStyle = unit.team === 'red' ? 'darkred' : 'darkblue';
        ctx.lineWidth = 3;
        ctx.stroke();
    }
    
    ctx.closePath();

    if (isSelected) {
        ctx.beginPath();
        ctx.arc(displayX, displayY, unit.radius + 4, 0, Math.PI * 2);
        ctx.strokeStyle = 'gold';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.closePath();
    }
    
    if (unit.isFighting) {
        ctx.beginPath();
        ctx.arc(displayX, displayY, unit.radius + 8, 0, Math.PI * 2);
        ctx.strokeStyle = 'red';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.closePath();
    }
    
    if (unit.health !== undefined) {
        const maxHealth = unit.type === "tank" ? 3000 : 1000;
        const healthPercentage = Math.max(0, unit.health / maxHealth);
        
        const barWidth = unit.radius * 2;
        const barHeight = 4;
        const barX = displayX - barWidth / 2;
        const barY = displayY - unit.radius - 8;
        
        ctx.fillStyle = 'red';
        ctx.fillRect(barX, barY, barWidth, barHeight);
        
        ctx.fillStyle = unit.isCutOff ? 'orange' : 'green';
        ctx.fillRect(barX, barY, barWidth * healthPercentage, barHeight);
        
        ctx.strokeStyle = unit.isCutOff ? 'red' : 'black';
        ctx.lineWidth = 1;
        ctx.strokeRect(barX, barY, barWidth, barHeight);
    }
}

function gameLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Calculate what's visible for this frame
    calculateVisibilityGrid();

    // Remove dead units
    units = units.filter(u => !u.isDead);
    
    // Draw territorial background and border first (background layer)
    drawBorder(border);
    
    // Draw the fog on top of the game world, but under units/cities
    drawFogOfWar();

    // Draw cities (middle layer)
    cities.forEach(drawCity);
    
    // Draw units on top (foreground layer)
    units.forEach(unit => {
        drawUnit(unit);
        
        if (unit.team === myTeam && unit.path && unit.path.length > 0) {
            drawPath(unit.path);
        }
    });

    // Draw the current path being created (UI, on top of everything)
    drawPath(currentPath);

    requestAnimationFrame(gameLoop);
}
