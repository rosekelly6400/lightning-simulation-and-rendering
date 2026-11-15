struct Attractor {
    position: vec4f,
};

struct LightningNode {
    position: vec4f,
};

struct LightningState {
    nodeCount: u32,
};

struct LightningParameters {
    influenceRadius: f32,
    deletionRadius: f32,
    stepLength: f32,
    directionWeight: f32,
};

@group(0) @binding(3)
var<uniform> params: LightningParameters;

@group(0) @binding(0)
var<storage, read_write> attractors: array<Attractor>;

@group(0) @binding(1)
var<storage, read_write> nodes: array<LightningNode>;

@group(0) @binding(2)
var<storage, read_write> state: LightningState;

fn random01(seed: f32) -> f32 {
    return fract(sin(seed * 12.9898) * 43758.5453);
}

@compute @workgroup_size(1)
fn main() {
    if (state.nodeCount == 0u || state.nodeCount >= arrayLength(&nodes)) {
        return;
    }

    let tipInd = state.nodeCount - 1u;
    let tipPos = nodes[tipInd].position.xyz;

    let iR = params.influenceRadius;
    let delR = params.deletionRadius;

    let endInd = arrayLength(&attractors) - 1u;
    let endPoint = attractors[endInd].position.xyz;

    if (attractors[endInd].position.w == 0.0) {
        return;
    }

    let distanceToEndpoint = length(endPoint - tipPos);

    if (distanceToEndpoint <= delR) {
        attractors[endInd].position.w = 0.0;
        return;
    }

    var dirSum = vec3f(0.0);
    var iCount = 0u;

    for (var index = 0u; index < arrayLength(&attractors); index = index + 1u) {
        let attractor = attractors[index];

        if (attractor.position.w == 0.0) {
            continue;
        }

        let toAttractor = attractor.position.xyz - tipPos;
        let distanceToTip = length(toAttractor);

        if (distanceToTip <= delR) {
            attractors[index].position.w = 0.0;
            continue;
        }

        if (distanceToTip > iR) {
            continue;
        }

        let attractionDir = toAttractor / distanceToTip;

        dirSum = dirSum + attractionDir;
        iCount = iCount + 1u;
    }

    var growthDir = vec3f(0.0);

    if (iCount > 0u && length(dirSum) > 0.00001) {
        let attractionDir = normalize(dirSum);
        //assumption i had. wasnt sure if its like a fixed direction for all of them or we calc. i recalced since it spasmed at the end 
        let preferredDir = normalize(endPoint - tipPos);

        let dirW = params.directionWeight;

        let blendedDir = attractionDir * (1.0 - dirW) + preferredDir * dirW;

        if (length(blendedDir) > 0.00001) {
            growthDir = normalize(blendedDir);
        }
    }

    // idk chat said to do this cause my stuff went jank
    if (length(growthDir) < 0.00001) {
        let toEnd = endPoint - tipPos;

        if (length(toEnd) < 0.00001) {
            return;
        }

        let forward = normalize(toEnd);

        var reference = vec3f(0.0, 1.0, 0.0);

        if (abs(forward.y) > 0.9) {
            reference = vec3f(1.0, 0.0, 0.0);
        }

        let side = normalize(cross(forward, reference));
        let up = cross(side, forward);

        let seed = f32(state.nodeCount);
        let azimuth = random01(seed) * 6.2831853;
        let angle = random01(seed + 100.0) * radians(32.0);

        let sideways = side * cos(azimuth) + up * sin(azimuth);

        growthDir = forward * cos(angle) + sideways * sin(angle);
    }

    let stepLength = params.stepLength;
    let nPos = tipPos + growthDir * stepLength;

    let nextIndex = state.nodeCount;

    nodes[nextIndex].position = vec4f(nPos, 1.0);

    state.nodeCount = nextIndex + 1u;

}
