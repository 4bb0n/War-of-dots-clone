const mouseInfo = { x: 0, y: 0, isDrawing: false };
function getMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
    };
}

function getUnitAt(pos) {
    console.log(`Looking for unit at position (${pos.x}, ${pos.y})`);
    console.log("All units:", units.map(u => ({ 
        id: u.id, 
        team: u.team, 
        x: u.x, 
        y: u.y, 
        radius: u.radius 
    })));
    
    // Find the top-most unit at the given position
    for (let i = units.length - 1; i >= 0; i--) {
        const unit = units[i];
        const dx = unit.x - pos.x;
        const dy = unit.y - pos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        console.log(`Unit ${unit.id} (${unit.team}): position (${unit.x}, ${unit.y}), distance: ${distance.toFixed(2)}, radius: ${unit.radius}`);
        
        if (distance < unit.radius) {
            console.log(`✓ FOUND unit ${unit.id} (${unit.team})`);
            return unit;
        }
    }
    console.log("✗ NO unit found at click position");
    return null;
}

canvas.addEventListener("mousemove", (e) => {
    if (!mouseInfo.isDrawing) return;
    const pos = getMousePos(e);

    if (selectedUnits.length > 0) {
        currentPath.push(pos);
        // Debug log to confirm this is where the issue is
        console.log("Moving with selected units:", selectedUnits.length);
    } else {
        console.log("No selected units in mousemove - this is the problem!");
    }
});

canvas.addEventListener("mousedown", (e) => {
    console.log("\n=== MOUSEDOWN EVENT ===");
    mouseInfo.isDrawing = true;
    const pos = getMousePos(e);
    console.log("Click position:", pos);
    console.log("My team:", myTeam);
    console.log("Canvas dimensions:", canvas.width, "x", canvas.height);
    
    const clickedUnit = getUnitAt(pos);
    const isShiftPressed = e.shiftKey;

    console.log("Clicked unit result:", clickedUnit);
    
    if (clickedUnit) {
        console.log(`Team check: clickedUnit.team="${clickedUnit.team}" === myTeam="${myTeam}" = ${clickedUnit.team === myTeam}`);
        console.log("Type check:", typeof clickedUnit.team, typeof myTeam);
        
        // Additional check for whitespace or invisible characters
        if (clickedUnit.team.trim() === myTeam.trim()) {
            console.log("Teams match after trimming!");
        } else {
            console.log("Teams don't match even after trimming");
        }
    }
    else{
        if (isShiftPressed){
            if (e.button === 0){
                socket.emit("createUnit", { x: pos.x, y: pos.y, team: myTeam });
            }
        }
    }

    if (clickedUnit && clickedUnit.team === myTeam) {
        console.log("✓ SELECTING UNIT");
        if (isShiftPressed) {
            const index = selectedUnits.findIndex(u => u.id === clickedUnit.id);
            if (index > -1) {
                selectedUnits.splice(index, 1);
                console.log("Removed from selection");
            } else {
                selectedUnits.push(clickedUnit);
                console.log("Added to selection");
            }
        } else {
            selectedUnits = [clickedUnit];
            console.log("Set as only selected unit");
        }
        currentPath = [pos];
        console.log("Selected units after click:", selectedUnits.map(u => ({ id: u.id, team: u.team })));
    } else {
        console.log("✗ NOT SELECTING UNIT");
        if (clickedUnit) {
            console.log("Reason: Wrong team");
        } else {
            console.log("Reason: No unit clicked");
        }
        
        if (!isShiftPressed) {
            if (selectedUnits.length > 0) {
                console.log("Clearing selection");
            }
            selectedUnits = [];
        }
    }
    console.log("Final selectedUnits:", selectedUnits.length);
    console.log("=== END MOUSEDOWN ===\n");
});

canvas.addEventListener("mouseup", (e) => {
    console.log("MOUSEUP - Selected units:", selectedUnits.length, "Path length:", currentPath.length);
    mouseInfo.isDrawing = false;
    if (selectedUnits.length > 0 && currentPath.length > 1) {
        const unitIds = selectedUnits.map(u => u.id);
        console.log("✓ SENDING MOVE COMMAND:", { unitIds, pathLength: currentPath.length });
        socket.emit('unitMove', { unitIds: unitIds, path: currentPath });
    } else {
        console.log("✗ NOT SENDING MOVE COMMAND");
        if (selectedUnits.length === 0) console.log("Reason: No selected units");
        if (currentPath.length <= 1) console.log("Reason: Path too short");
    }
    currentPath = [];
});