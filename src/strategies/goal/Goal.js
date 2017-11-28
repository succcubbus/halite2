const log = require('../../hlt/Log');
const DockingGoal = require('./DockingGoal');
const AttackGoal = require('./AttackGoal');
const DefenseGoal = require('./DefenseGoal');
const KamikazeGoal = require('./KamikazeGoal');
const ShipIntents = require('./ShipIntents');
const GoalIntent = require('./GoalIntent');
const Geometry = require("../../hlt/Geometry");
const Simulation = require("../Simulation");

function getActions(gameMap) {
    const goals = identifyGoals(gameMap);

    const ratedGoals = rateGoals(gameMap, goals);

    const requests = calcShipRequests(gameMap, ratedGoals);

    const grantedShips = magicLoop(gameMap, requests);

    return grantedShips.flatMap(({goal, ships}) => goal.getShipCommands(gameMap, ships))
}

function identifyGoals(gameMap) {
    const planetGoals = gameMap.planets
        .filter(planet => (planet.isOwnedByMe() && planet.freeDockingSpots > 0) || planet.isFree())
        .map(planet => new DockingGoal(gameMap, planet));

    const defenseGoals = gameMap.planets
        .filter(planet => planet.isOwnedByMe())
        .map(planet => new DefenseGoal(gameMap, planet));

    const attackGoals = gameMap.enemyShips.map(ship => new AttackGoal(gameMap, ship));

    const kamikazeGoals = gameMap.myShips
        .filter(ship => ship.isUndocked())
        .map(ship => new KamikazeGoal(gameMap, ship));

    return [...planetGoals, ...defenseGoals, ...attackGoals, ...kamikazeGoals];
}

function rateGoals(gameMap, goals) {
    const maxDistance = gameMap.maxDistance / 2;
    const populatedPlanetsPct = gameMap.planets.filter(p => p.isOwned()).length / gameMap.planets.length;

    goals.forEach(goal => {
        if (goal instanceof DockingGoal) {
            goal.score = 0.98;

            const distance = Geometry.distance(goal.planet, {x: gameMap.width / 2, y: gameMap.height / 2});

            const heuristic = gameMap.planetHeuristics;
            const radiusDifference = (heuristic.biggestRadius - heuristic.smallestRadius) || heuristic.biggestRadius;
            const radiusScore = (goal.planet.radius - heuristic.smallestRadius) / radiusDifference;

            const distanceDifference = (heuristic.biggestDistances - heuristic.smallestDistances) || heuristic.biggestDistances;
            const densityScore = (heuristic.planetDistances[goal.planet.id].sum - heuristic.smallestDistances) / distanceDifference;

            if (gameMap.numberOfPlayers === 4 && populatedPlanetsPct <= 0.6) {
                goal.score += (distance / maxDistance - 0.5) * 0.1;

                const nearestOpponent = Simulation.nearestEntity(gameMap.enemyShips, goal.planet).dist;
                if (nearestOpponent < 15)
                    goal.score -= 0.025;
                else
                    goal.score += 0.025;

                goal.score += radiusScore * 0.002 - 0.001;
                goal.score += densityScore * 0.02 - 0.01;
            } else if (gameMap.numberOfPlayers === 2) {
                goal.score += densityScore * 0.01 - 0.005;
            }
        } else if (goal instanceof DefenseGoal) {
            goal.score = 1;
        } else if (goal instanceof AttackGoal) {
            if (goal.enemy.isUndocked()) {
                goal.score = 1.02;
            } else if (goal.enemy.isUndocking()) {
                goal.score = 1.045;
            } else {
                goal.score = 1.04;
            }
        } else if (goal instanceof KamikazeGoal) {
            goal.score = 2;
        }
    });

    return goals;
}

function calcShipRequests(gameMap, goals) {
    return goals
        .flatMap(goal => goal.shipRequests(gameMap))
        .map(goalIntent => new GoalIntent(goalIntent.ship, goalIntent.goal, goalIntent.score * goalIntent.goal.score))
        .groupBy(shipRequest => shipRequest.ship)
        .map(entry => new ShipIntents(entry.key, entry.values));
}

function magicLoop(gameMap, shipIntents) {
    // TODO: do magic stuff to assign ships to goals based on effectiveness

    // [{goal, [shipIntents]}]
    const grantedShips = shipIntents
        .map((shipIntents) => {
            shipIntents.intents.sort((a, b) => b.score - a.score);
            return {shipIntents, goal: shipIntents.intents[0].goal};
        })
        .groupBy(entry => entry.goal)
        .map(({key, values}) => ({goal: key, shipIntents: values.map(entry => entry.shipIntents)}));

    grantedShips.forEach(({goal, shipIntents}) => {
        const max = goal.effectivenessPerShip(gameMap);

        if (shipIntents.length > max) {
            shipIntents
                .sort((a, b) => b.intents[0].score - a.intents[0].score)
                .slice(max)
                .forEach(shipIntent => shipIntent.intents[0].score -= .15);
        }
    });

    return shipIntents
        .map((shipIntents) => {
            shipIntents.intents.sort((a, b) => b.score - a.score);
            return {ship: shipIntents.ship, goal: shipIntents.intents[0].goal};
        })
        .groupBy(entry => entry.goal)
        .map(({key, values}) => ({goal: key, ships: values.map(entry => entry.ship)}));
}


module.exports = {getActions};