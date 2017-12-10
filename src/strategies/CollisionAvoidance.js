const log = require('../hlt/Log');
const Geometry = require('../hlt/Geometry');
const Simulation = require('./Simulation');
const constants = require('../hlt/Constants');

function resolveWallCollisions(gameMap, thrust) {
    const position = Simulation.positionNextTick(thrust.ship, thrust.speed, thrust.angle);
    if(Simulation.insideWall(gameMap, position)) {
        const escape = Simulation.getWallEscape(gameMap, thrust.ship, position, thrust.speed);
        thrust.speed = Math.min(7, Geometry.distance(thrust.ship, escape));
        thrust.angle = Geometry.angleInDegree(thrust.ship, escape);
    }
}

/**
 * Find all thrusts that have a similar angle, but would intersect with the current thrust.
 * For these thrusts take the average angle and apply it to them.
 *
 * @param current Thrust intent to compare against
 * @param thrusts All thrust intents
 */
function alignSimilarAngles(current, thrusts) {
    // find all thrusts with similar angle
    const similarThrusts = thrusts.filter(thrust2 => Geometry.distance(current.ship, thrust2.ship) <= constants.MAX_SPEED)
        .filter(thrust2 => {
            const betweenShipsAngle = Geometry.angleInDegree(current.ship, thrust2.ship);
            const thrustShipAngle = Geometry.angleBetween(current.angle, betweenShipsAngle);
            const thrustAngle = Geometry.angleBetween(current.angle, thrust2.angle);
            // check if thrustShipAngle and thrustAngle have the same sign
            return Math.abs(thrustAngle) < 10 && thrustShipAngle * thrustAngle >= 0;
        });

    if (similarThrusts.length === 1)
        return;

    // calculate the average angle
    const avgDifference =
        similarThrusts
            .map(thrust2 => Geometry.angleBetween(current.angle, thrust2.angle)) // make relative to current to avoid 1, 359 issue
            .reduce((prev, cur) => prev + cur, 0) / similarThrusts.length;
    const avgAngle = (current.angle + avgDifference + 360) % 360;

    log.log("align angles " + similarThrusts.map(t => t.ship) + " to " + avgAngle);

    // apply it
    similarThrusts.forEach(thrust => thrust.angle = avgAngle);
}

/**
 * Reduce the speed of all thrusts, that would, in the next tick, end up in the same
 * location as the current thrust.
 *
 * @param current Thrust intent to compare against
 * @param thrusts All thrust intents
 */
function resolveDestinationConflicts(current, thrusts) {
    thrusts
        .filter(thrust2 => current.ship !== thrust2.ship)
        .filter(thrust2 => Geometry.distance(current.ship, thrust2.ship) <= constants.MAX_SPEED * 2 + constants.SHIP_RADIUS * 2)
        .filter(thrust2 => {
            let next1 = Simulation.positionNextTick(current.ship, current.speed, current.angle);
            let next2 = Simulation.positionNextTick(thrust2.ship, thrust2.speed, thrust2.angle);
            return Geometry.distance(next1, next2) <= constants.SHIP_RADIUS * 2.2;
        })
        .forEach(thrust2 => {
            thrust2.speed = Math.max(0, thrust2.speed - 1.5);
            log.log("throttling speed for " + thrust2.ship + " to " + thrust2.speed + " because of " + current.ship);
        });
}

function resolveCollisions(current, thrusts) {
    thrusts
        .filter(thrust2 => current.ship !== thrust2.ship)
        .filter(thrust2 => Geometry.distance(current.ship, thrust2.ship) <= constants.MAX_SPEED * 2 + constants.SHIP_RADIUS * 2)
        .forEach(thrust2 => {
            const t1 = Simulation.toVector(current.speed, current.angle);
            const t2 = Simulation.toVector(thrust2.speed, thrust2.angle);
            const {collision} = Simulation.collisionTime(constants.SHIP_RADIUS * 2, current.ship, thrust2.ship, t1, t2);

            if (collision) {
                log.log(`swapping: ${current.ship.id} <> ${thrust2.ship.id}`);
                t1.x += current.ship.x;
                t1.y += current.ship.y;

                t2.x += thrust2.ship.x;
                t2.y += thrust2.ship.y;

                const tmp = thrust2.ship;
                thrust2.ship = current.ship;
                thrust2.speed = Math.min(7, Geometry.distance(thrust2.ship, t2));
                thrust2.angle = Geometry.angleInDegree(thrust2.ship, t2);

                current.ship = tmp;
                current.speed = Math.min(7, Geometry.distance(current.ship, t1));
                current.angle = Geometry.angleInDegree(current.ship, t1);
            }

        })
}

module.exports = {resolveWallCollisions, alignSimilarAngles, resolveDestinationConflicts, resolveCollisions};