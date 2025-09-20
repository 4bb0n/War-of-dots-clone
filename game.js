class Game{
    constructor(player){
        this.teamRed = player
        this.teamBlue = null
        this.redUnits = []
        this.blueUnits = []
        this.started = false;
        this.redCities = []
        this.blueCities = [];

        // Initialize the border down the middle of the map
        this.borderPoints = [];
        const BORDER_RESOLUTION = 15; // The distance between points on the border line
        for (let y = 0; y <= 600; y += BORDER_RESOLUTION) {
            this.borderPoints.push({ x: 500, y: y, targetX: 500 });
        }
    }
    startGame(){
        this.started = true
    }
    joinGame(player){
        this.teamBlue = player
        this.startGame()
    }
}
let unitIdCounter = 0;
let cityIdCounter = 0;

class Unit{
    constructor(x, y, team, type = "infantry"){
        this.id = unitIdCounter++;
        this.x = x
        this.y = y
        this.team = team
        this.type = type;
        this.radius = 10;
        this.path = [];

        if (this.type === "infantry"){
            this.health = 1000;
            this.maxHealth = 1000;
            this.attackDamage = 0.05;
            this.speed = 0.5;
            this.speed = 0.5; // px per frame
        }
        else if (this.type === "tank"){
            this.health = 3000;
            this.maxHealth = 3000;
            this.attackDamage = 0.1;
            this.speed = 0.3;
            this.speed = 0.4; // px per frame
        }
    }
    moveTo(x, y){
        this.x = x
        this.y = y
        this.x = x;
        this.y = y;
    }

    setPath(path) {
        this.path = path;
    }

    // This update logic will run on the client
    update() {
        if (this.path.length === 0) return;

        const target = this.path[0];
        const dx = target.x - this.x;
        const dy = target.y - this.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < this.speed) {
            this.x = target.x;
            this.y = target.y;
            this.path.shift(); // Move to the next point in the path
        } else {
            // Move towards the target
            this.x += (dx / distance) * this.speed;
            this.y += (dy / distance) * this.speed;
        if (this.path && this.path.length > 0) {
            const target = this.path[0];
            const dx = target.x - this.x;
            const dy = target.y - this.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
    
            if (distance < this.speed) {
                this.x = target.x;
                this.y = target.y;
                this.path.shift(); // Move to the next point in the path
            } else {
                // Move towards the target
                this.x += (dx / distance) * this.speed;
                this.y += (dy / distance) * this.speed;
            }
        }
    }
    if (this.health < 1000){
        this.health += 0.1;
    }
}
}
class City{
    constructor(x, y, team){
        this.id = cityIdCounter++;
        this.x = x
        this.y = y
        this.radius = 20;
        this.spawnInterval = 1500;
        this.team = team;
        this.spawnCount = 0;
    }
    update(){
        this.spawnInterval -= 1;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Game, Unit , City};
}