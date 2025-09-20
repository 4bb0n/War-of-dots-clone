const canvas = document.getElementById("map-canvas");
const ctx = canvas.getContext("2d");

const state = {
    brush: 'city', // 'infantry', 'tank', 'city', or 'territory'
    team: 'red',   // 'red', 'blue', or 'neutral'
    cities: [],
    units: [],
    territoryGrid: [],
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

    // Canvas events
    canvas.addEventListener('mousedown', handleCanvasClick);
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

function handleCanvasClick(e) {
    if (e.button !== 0) return;
    const pos = getMousePos(e);

    if (state.brush === 'territory') {
        const gridX = Math.floor(pos.x / state.GRID_SIZE);
        const gridY = Math.floor(pos.y / state.GRID_SIZE);
        const teamValue = state.team === 'red' ? 1 : (state.team === 'blue' ? 2 : 0);
        state.territoryGrid[gridY][gridX] = teamValue;
    } else if (state.team !== 'neutral') {
        if (state.brush === 'city') {
            state.cities.push({ x: pos.x, y: pos.y, team: state.team, radius: 20 });
        } else if (state.brush === 'infantry' || state.brush === 'tank') {
            state.units.push({ x: pos.x, y: pos.y, team: state.team, type: state.brush, radius: 10 });
        }
    }
    draw();
}

function handleRightClick(e) {
    e.preventDefault();
    const pos = getMousePos(e);

    for (let i = state.units.length - 1; i >= 0; i--) {
        const unit = state.units[i];
        const distance = Math.hypot(unit.x - pos.x, unit.y - pos.y);
        if (distance < unit.radius) {
            state.units.splice(i, 1);
            draw();
            return;
        }
    }

    for (let i = state.cities.length - 1; i >= 0; i--) {
        const city = state.cities[i];
        const distance = Math.hypot(city.x - pos.x, city.y - pos.y);
        if (distance < city.radius) {
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

function handleMapLoad(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const mapData = JSON.parse(e.target.result);

            if (!mapData.cities || !mapData.territoryGrid) {
                throw new Error("Invalid map file. Missing 'cities' or 'territoryGrid'.");
            }
            
            state.cities = mapData.cities;
            state.units = mapData.units || [];
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

// --- DRAWING ---
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

// --- EXPORT ---
function exportMap() {
    // THE FIX IS HERE: We are no longer stripping the 'radius' property.
    // The entire state object for cities and units is now saved.
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

// Start the application
initialize();