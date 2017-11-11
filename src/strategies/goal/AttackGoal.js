const ActionThrust = require("../ActionThrust");
const Geometry = require("../../hlt/Geometry");
const GoalIntent = require('./GoalIntent');
const {findPath} = require("../LineNavigation");

class AttackGoal {
    constructor(enemy) {
        this.enemy = enemy;
    }

    shipRequests(gameMap) {
        return gameMap.myShips.map(ship => {
            const maxDistance = Math.sqrt(Math.pow(gameMap.width, 2) + Math.pow(gameMap.height, 2));

            let score = 1 - Geometry.distance(ship, this.enemy) / maxDistance;
            return new GoalIntent(ship, this, score);
        })
    }

    effectivenessPerShip(shipSet) {
        return 1;
    }

    getShipCommands(gameMap, ships) {
        return ships.map(ship => {
            return AttackGoal.navigateAttack(gameMap, ship, this.enemy);
        })
    }

    toString() {
        return "attack->" + this.enemy;
    }

    static navigateAttack(gameMap, ship, enemy) {
        const {speed, angle} = findPath(gameMap, ship, enemy);
        return new ActionThrust(ship, speed, angle);
    }
}

module.exports = AttackGoal;