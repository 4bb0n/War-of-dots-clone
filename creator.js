const canvas = document.getElementById("map-canvas");
const ctx = canvas.getContext("2d");

const state = {
    brush: 'city',
    team: 'red',
    cities: [],
    units: [],
    territoryGrid: [],
    isPainting: false, // NEW: Tracks if the mouse is held down for painting
    GRID_SIZE: 20,
    GRID_WIDTH: canvas.width / 20,
    GRID_HEIGHT: canvas.height / 20,
};

// --- INITIALIZATION ---
function initialize() {
    for (let y = 0; y < state.GRID_HEIGHT; y++) {
        state.territoryGrid[y] = [];
        for (let x = 0; x < state.GRID_WIDTH; x++) {
            state.territoryGrid[y][x] = 0;
        }
    }
    setupUI();
    draw();
}

// --- UI AND EVENT HANDLING ---
function setupUI() {
    // Brush buttons
    document.getElementById('brush-infantry').onclick = () => selectBrush('infantry');
    document.getElementById('brush-tank').onclick = () => selectBrush('tank');
    document.getElementById('brush-city').onclick = () => selectBrush('city');
    document.getElementById('brush-territory').onclick = () => selectBrush('territory');

    // Team buttons
    document.getElementById('team-red').onclick = () => selectTeam('red');
    document.getElementById('team-blue').onclick = () => selectTeam('blue');
    document.getElementById('team-neutral').onclick = () => selectTeam('neutral');
    
    // File buttons
    document.getElementById('export-map').onclick = exportMap;
    const loadMapInput = document.getElementById('load-map-input');
    const loadMapButton = document.getElementById('load-map-button');
    loadMapButton.onclick = () => loadMapInput.click();
    loadMapInput.onchange = handleMapLoad;

    // --- MODIFIED EVENT LISTENERS ---
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp); // Listen on window to catch all mouseup events
    canvas.addEventListener('contextmenu', handleRightClick);
}

function selectBrush(brush) {
    state.brush = brush;
    ['infantry', 'tank', 'city', 'territory'].forEach(b => {
        document.getElementById(`brush-${b}`).classList.toggle('selected', b === brush);
    });
}

function selectTeam(team) {
    state.team = team;
    ['red', 'blue', 'neutral'].forEach(t => {
        document.getElementById(`team-${t}`).classList.toggle('selected', t === team);
    });
}

// NEW: Helper function to paint a single territory cell
function paintTerritoryAt(pos) {
    if (pos.x < 0 || pos.x > canvas.width || pos.y < 0 || pos.y > canvas.height) {
        return; // Don't paint outside the canvas
    }
    const gridX = Math.floor(pos.x / state.GRID_SIZE);
    const gridY = Math.floor(pos.y / state.GRID_SIZE);
    const teamValue = state.team === 'red' ? 1 : (state.team === 'blue' ? 2 : 0);

    // Only update and redraw if the cell's team is changing
    if (gridX < state.GRID_WIDTH && gridY < state.GRID_HEIGHT && state.territoryGrid[gridY][gridX] !== teamValue) {
        state.territoryGrid[gridY][gridX] = teamValue;
        draw();
    }
}

// MODIFIED: This now handles starting actions
function handleMouseDown(e) {
    if (e.button !== 0) return; // Only respond to left-click
    const pos = getMousePos(e);

    if (state.brush === 'territory') {
        state.isPainting = true;
        paintTerritoryAt(pos); // Paint the initial cell on the first click
    } else if (state.team !== 'neutral') {
        // Handle placing single objects (cities/units)
        if (state.brush === 'city') {
            state.cities.push({ x: pos.x, y: pos.y, team: state.team, radius: 20 });
        } else if (state.brush === 'infantry' || state.brush === 'tank') {
            state.units.push({ x: pos.x, y: pos.y, team: state.team, type: state.brush, radius: 10 });
        }
        draw();
    }
}

// NEW: Handles painting while the mouse is moving and held down
function handleMouseMove(e) {
    if (!state.isPainting) return; // Only paint if mouse is down
    paintTerritoryAt(getMousePos(e));
}

// NEW: Stops painting when the mouse button is released
function handleMouseUp() {
    state.isPainting = false;
}

function handleRightClick(e) {
    e.preventDefault();
    const pos = getMousePos(e);

    // Check units first
    for (let i = state.units.length - 1; i >= 0; i--) {
        const unit = state.units[i];
        if (Math.hypot(unit.x - pos.x, unit.y - pos.y) < unit.radius) {
            state.units.splice(i, 1);
            draw();
            return;
        }
    }
    // Then check cities
    for (let i = state.cities.length - 1; i >= 0; i--) {
        const city = state.cities[i];
        if (Math.hypot(city.x - pos.x, city.y - pos.y) < city.radius) {
            state.cities.splice(i, 1);
            draw();
            return;
        }
    }
}

function getMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}


// --- FILE HANDLING (Unchanged) ---
function handleMapLoad(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const mapData = JSON.parse(e.target.result);
            if (!mapData.cities || !mapData.territoryGrid) {
                throw new Error("Invalid map file format.");
            }
            state.cities = mapData.cities.map(city => ({
                x: city.x, y: city.y, team: city.team, radius: city.radius || 20
            }));
            state.units = (mapData.units || []).map(unit => ({
                x: unit.x, y: unit.y, team: unit.team, type: unit.type, radius: unit.radius || 10
            }));
            state.territoryGrid = mapData.territoryGrid;
            console.log("Map loaded successfully!");
            draw();
        } catch (error) {
            alert(`Error loading map: ${error.message}`);
        }
    };
    reader.readAsText(file);
    event.target.value = null;
}

function exportMap() {
    const mapData = {
        cities: state.cities,
        units: state.units,
        territoryGrid: state.territoryGrid
    };
    const dataStr = JSON.stringify(mapData, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'custom_map.json';
    a.click();
    URL.revokeObjectURL(url);
}


// --- DRAWING FUNCTIONS (Unchanged) ---
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawTerritory();
    drawCities();
    drawUnits();
}
function drawTerritory() {
    for (let y = 0; y < state.GRID_HEIGHT; y++) {
        for (let x = 0; x < state.GRID_WIDTH; x++) {
            const teamValue = state.territoryGrid[y][x];
            if (teamValue === 1) ctx.fillStyle = 'rgba(255, 100, 100, 0.25)';
            else if (teamValue === 2) ctx.fillStyle = 'rgba(100, 100, 255, 0.25)';
            else continue;
            ctx.fillRect(x * state.GRID_SIZE, y * state.GRID_SIZE, state.GRID_SIZE, state.GRID_SIZE);
        }
    }
}
function drawCities() {
    state.cities.forEach(city => {
        ctx.beginPath();
        ctx.arc(city.x, city.y, city.radius, 0, Math.PI * 2);
        ctx.fillStyle = city.team;
        ctx.fill();
        ctx.closePath();
    });
}
function drawUnits() {
    state.units.forEach(unit => {
        ctx.beginPath();
        ctx.arc(unit.x, unit.y, unit.radius, 0, Math.PI * 2);
        ctx.fillStyle = unit.team;
        ctx.fill();
        if (unit.type === "tank") {
            ctx.strokeStyle = unit.team === 'red' ? 'darkred' : 'darkblue';
            ctx.lineWidth = 3;
            ctx.stroke();
        }
        ctx.closePath();
    });
}

// Start the application
initialize();
