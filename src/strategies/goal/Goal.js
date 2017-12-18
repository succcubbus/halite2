const log = require('../../hlt/Log');
const DockingGoal = require('./DockingGoal');
const AttackGoal = require('./AttackGoal');
const DefenseGoal = require('./DefenseGoal');
const KamikazeGoal = require('./KamikazeGoal');
const HarassmentGoal = require('./HarassmentGoal');
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

    const attackGoals = [];
    let enemyShips = gameMap.enemyShips;

    enemyShips.forEach(nextEnemy => {
        const nearbyGoal = attackGoals.some(goal => Geometry.distance(nextEnemy, goal.enemy) < 6);
        const nearbyDefense = defenseGoals.some(goal => Geometry.distance(nextEnemy, goal.planet) < goal.planet.radius + 7);

        if (!nearbyGoal && !nearbyDefense) {
            attackGoals.push(new AttackGoal(gameMap, nextEnemy));
        }
    });

    const kamikazeGoals = gameMap.myShips
        .filter(ship => ship.isUndocked())
        .map(ship => new KamikazeGoal(gameMap, ship));

    const goals = [...planetGoals, ...defenseGoals, ...attackGoals, ...kamikazeGoals];

    const myAvgPos = Geometry.averagePos(gameMap.myShips);
    const enemyAverages = gameMap.playerIds
        .filter(id => id !== gameMap.myPlayerId)
        .map(id => [id, gameMap.playerShips(id)])
        .map(([id, ships]) => [id, Geometry.averagePos(ships)])
        .map(([id, avgPos]) => [id, Geometry.distance(avgPos, myAvgPos)])
        .sort((a, b) => a[1] - b[1]);

    const harassPlayerId = enemyAverages[0][0];
    const shipPct = gameMap.myShips.length / (gameMap.myShips.length + gameMap.playerShips(harassPlayerId).length);
    if (gameMap.numberOfPlayers === 2 && gameMap.playerShips(harassPlayerId).length < 15 && shipPct < 0.75) {
        const harassmentGoal = new HarassmentGoal(gameMap, harassPlayerId);

        goals.push(harassmentGoal);
    }

    return goals;
}

function rateGoals(gameMap, goals) {
    const maxDistance = gameMap.maxDistance / 2;
    const populatedPlanetsPct = gameMap.planets.filter(p => p.isOwned()).length / gameMap.planets.length;

    goals.forEach(goal => {
        if (goal instanceof DockingGoal) {
            goal.score = 0.98;

            const distance = Geometry.distance(goal.planet, {x: gameMap.width / 2, y: gameMap.height / 2});

            const heuristic = gameMap.planetHeuristics;
            const radiusDifference = (heuristic.biggestRadius - heuristic.smallestRadius) || heuristic.smallestRadius;
            const radiusScore = (goal.planet.radius - heuristic.smallestRadius) / radiusDifference;

            const distanceDifference = (heuristic.biggestDistances - heuristic.smallestDistances) || heuristic.smallestDistances;
            const densityScore = (heuristic.planetDistances[goal.planet.id].sum - heuristic.smallestDistances) / distanceDifference;

            const enemyDifference = (heuristic.enemyDistance.biggest - heuristic.enemyDistance.smallest) || heuristic.enemyDistance.smallest;
            const enemyScore = ((heuristic.enemyDistance.average[goal.planet.id] - heuristic.enemyDistance.smallest) / enemyDifference);

            if (gameMap.numberOfPlayers === 4 && populatedPlanetsPct <= 0.6) {
                goal.score += 0.01;
                goal.score += distance / maxDistance * 0.1 - 0.05;

                const nearestOpponent = Simulation.nearestEntity(gameMap.enemyShips, goal.planet).dist;
                if (nearestOpponent < goal.planet.radius + 22)
                    goal.score -= 0.03;
                else
                    goal.score += 0.025;

                goal.score += radiusScore * 0.002 - 0.001;
                goal.score += densityScore * 0.02 - 0.01;
                goal.score += enemyScore * 0.02 - 0.01;
                goal.score += goal.planet.freeDockingSpots / 6 * 0.1 - 0.05;
            } else if (gameMap.numberOfPlayers === 2) {
                const nearestOpponent = Simulation.nearestEntity(gameMap.enemyShips, goal.planet).dist;
                if (nearestOpponent < goal.planet.radius + 22)
                    goal.score -= 0.03;
                else
                    goal.score += 0.025;
                goal.score += goal.planet.freeDockingSpots / 6 * 0.2 - 0.1;
                // goal.score -= densityScore * 0.02 - 0.01;
            }
        } else if (goal instanceof DefenseGoal) {
            goal.score = 1.08;
        } else if (goal instanceof AttackGoal) {
            if (goal.enemy.isUndocked()) {
                goal.score = 1.02;
            } else if (goal.enemy.isUndocking()) {
                goal.score = 1.045;
            } else {
                goal.score = 1.04;
            }
        } else if (goal instanceof KamikazeGoal) {
            goal.score = 1.9;
        } else if (goal instanceof HarassmentGoal) {
            goal.score = 1.25;
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
    // do magic stuff to assign ships to goals based on effectiveness

    for (let i = 0; i < 50; i++) {
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
                    .map(shipIntent => shipIntent.intents[0])
                    .sort((a, b) => b.score - a.score)
                    .slice(max)
                    .forEach(goalIntent => goalIntent.score -= .01);
            }
        });
    }

    return shipIntents
        .map((shipIntents) => {
            shipIntents.intents.sort((a, b) => b.score - a.score);
            return {ship: shipIntents.ship, goal: shipIntents.intents[0].goal};
        })
        .groupBy(entry => entry.goal)
        .map(({key, values}) => ({goal: key, ships: values.map(entry => entry.ship)}));
}


module.exports = {getActions};