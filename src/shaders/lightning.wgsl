struct Attractor {
    position: vec4f,
};

struct LightningNode {
    position: vec4f,
    parentIndex: u32,
    channelIndex: u32,
    depth: u32,
    valid: u32,
};

struct LightningState {
    nodeCount: u32,
    status: u32,
    endpointDistance: f32,
    maximumDepth: u32,
    secondaryCount: u32,
    tertiaryCount: u32,
    failedBranches: u32,
    padding: u32,
};

struct LightningChannel {
    start: vec4f,
    endpoint: vec4f,
    nodeStart: u32,
    nodeCapacity: u32,
    nodeCount: u32,
    status: u32,
    attractorStart: u32,
    attractorCount: u32,
    rootNode: u32,
    order: u32,
};

struct LightningParameters {
    influenceRadius: f32,
    deletionRadius: f32,
    stepLength: f32,
    directionWeight: f32,
    seed: u32,
    padding0: f32,
    padding1: f32,
    padding2: f32,
    secondaryMinLength: f32,
    secondaryMaxLength: f32,
    secondaryProbability: f32,
    tertiaryMinLength: f32,
    tertiaryMaxLength: f32,
    tertiaryProbability: f32,
    padding3: f32,
    padding4: f32,
};

override stepsPerDispatch: u32 = 32u;

const PRIMARY_NODES = 1024u;
const SECONDARY_CHANNELS = 128u;
const SECONDARY_NODES = 128u;
const TERTIARY_CHANNELS = 512u;
const TERTIARY_NODES = 64u;
const PRIMARY_ATTRACTORS = 2049u;
const SECONDARY_ATTRACTORS = 257u;
const TERTIARY_ATTRACTORS = 129u;
const RUNNING = 1u;
const REACHED = 2u;
const CAPACITY_REACHED = 3u;
const INVALID = 4u;

@group(0) @binding(0)
var<storage, read_write> attractors: array<Attractor>;
@group(0) @binding(1)
var<storage, read_write> nodes: array<LightningNode>;
@group(0) @binding(2)
var<storage, read_write> state: LightningState;
@group(0) @binding(3)
var<uniform> params: LightningParameters;
@group(0) @binding(4)
var<storage, read_write> channels: array<LightningChannel>;

struct LightningBoltPoints {
    count: u32,
    // vec4f alignment places the first point at byte 16.
    points: array<vec4f>,
};

@group(0) @binding(5)
var<storage, read_write> boltPoints: LightningBoltPoints;

fn branchRandom(seed: u32) -> f32 {
    var value = seed + params.seed;
    value = (value ^ (value >> 16u)) * 0x7feb352du;
    value = (value ^ (value >> 15u)) * 0x846ca68bu;
    value = value ^ (value >> 16u);
    return f32(value >> 8u) / 16777216.0;
}

fn perpendicular(forward: vec3f) -> vec3f {
    var reference = vec3f(0.0, 1.0, 0.0);
    if (abs(forward.y) > 0.9) {
        reference = vec3f(1.0, 0.0, 0.0);
    }
    return normalize(cross(forward, reference));
}

@compute @workgroup_size(1)
fn main() {
    if (channels[0].status == 0u) {
        let start = nodes[0].position.xyz;
        let endpoint = attractors[PRIMARY_ATTRACTORS - 1u].position.xyz;
        channels[0] = LightningChannel(
            vec4f(start, length(endpoint - start)), vec4f(endpoint, 1.0),
            0u, PRIMARY_NODES, 1u, RUNNING,
            0u, PRIMARY_ATTRACTORS, 0u, 0u
        );
    }
    growBatch(0u);
}

fn growBatch(channelIndex: u32) {
    for (var step = 0u; step < stepsPerDispatch; step++) {
        if (channels[channelIndex].status != RUNNING) {
            break;
        }
        growOneStep(channelIndex);
    }
}

fn channelDeletionRadius(channel: LightningChannel) -> f32 {
    if (channel.order == 0u) {
        return params.deletionRadius;
    }
    return min(params.deletionRadius, channel.start.w * 0.06);
}

fn channelInfluenceRadius(channel: LightningChannel) -> f32 {
    if (channel.order == 0u) {
        return params.influenceRadius;
    }
    return min(params.influenceRadius, channel.start.w * 0.20);
}

fn channelDirectionWeight(channel: LightningChannel) -> f32 {
    if (channel.order == 0u) {
        return params.directionWeight;
    }
    
    return params.directionWeight * (11.0 / 12.0);
}

fn channelStepLength(channel: LightningChannel) -> f32 {
    if (channel.order == 0u) {
        return params.stepLength;
    }
    return min(params.stepLength, channel.start.w / 24.0);
}

fn growOneStep(channelIndex: u32) {
    let channel = channels[channelIndex];
    if (channel.nodeCount == 0u || channel.nodeCount > channel.nodeCapacity ||
        channel.nodeStart + channel.nodeCapacity > arrayLength(&nodes) ||
        channel.attractorCount == 0u ||
        channel.attractorStart + channel.attractorCount > arrayLength(&attractors)) {
        channels[channelIndex].status = INVALID;
        return;
    }
    let tipInd = channel.nodeStart + channel.nodeCount - 1u;
    let tipPos = nodes[tipInd].position.xyz;
    let iR = channelInfluenceRadius(channel);
    let delR = channelDeletionRadius(channel);
    let endInd = channel.attractorStart + channel.attractorCount - 1u;
    let endPoint = channel.endpoint.xyz;
    let distanceToEndpoint = length(endPoint - tipPos);
    if (attractors[endInd].position.w == 0.0 || distanceToEndpoint <= delR) {
        attractors[endInd].position.w = 0.0;
        channels[channelIndex].status = REACHED;
        return;
    }
    if (channel.nodeCount >= channel.nodeCapacity) {
        channels[channelIndex].status = CAPACITY_REACHED;
        return;
    }

    var dirSum = vec3f(0.0);
    var iCount = 0u;
    for (var index = channel.attractorStart; index <= endInd; index++) {
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
        let dirW = channelDirectionWeight(channel);
        let blendedDir = attractionDir * (1.0 - dirW) + preferredDir * dirW;
        if (length(blendedDir) > 0.00001) {
            growthDir = normalize(blendedDir);
        }
    }

    if (length(growthDir) < 0.00001) {
        let toEnd = endPoint - tipPos;
        if (length(toEnd) < 0.00001) {
            channels[channelIndex].status = REACHED;
            return;
        }
        let forward = normalize(toEnd);
        let side = perpendicular(forward);
        let up = cross(side, forward);
        let seed = channel.nodeCount + channelIndex * PRIMARY_NODES;
        let azimuth = branchRandom(seed + 700001u) * 6.2831853;
        let angle = branchRandom(seed + 800011u) * radians(32.0);
        let sideways = side * cos(azimuth) + up * sin(azimuth);
        growthDir = forward * cos(angle) + sideways * sin(angle);
    }

    let stepLength = min(channelStepLength(channel), distanceToEndpoint);
    let nPos = tipPos + growthDir * stepLength;
    let nextIndex = channel.nodeStart + channel.nodeCount;
    nodes[nextIndex] = LightningNode(vec4f(nPos, 1.0), tipInd, channelIndex, nodes[tipInd].depth + 1u, 1u);
    channels[channelIndex].nodeCount = channel.nodeCount + 1u;
    if (length(endPoint - nPos) <= delR) {
        attractors[endInd].position.w = 0.0;
        channels[channelIndex].status = REACHED;
    } else if (channel.nodeCount + 1u >= channel.nodeCapacity) {
        channels[channelIndex].status = CAPACITY_REACHED;
    }
}

fn prepareBranch(channelIndex: u32, parentChannelIndex: u32, rootIndex: u32) {
    let parent = channels[parentChannelIndex];
    let root = nodes[rootIndex];
    var forward = parent.endpoint.xyz - parent.start.xyz;
    let tangent = root.position.xyz - nodes[root.parentIndex].position.xyz;
    if (length(tangent) > 0.00001) {
        forward = tangent;
    }
    forward = normalize(forward);
    let side = perpendicular(forward);
    let up = cross(side, forward);
    let seed = rootIndex * 101u + channelIndex * 10007u;
    let distanceFraction = clamp(length(parent.endpoint.xyz - root.position.xyz) / max(parent.start.w, 0.00001), 0.0, 1.0);
    let maximumInclination = mix(45.0, 85.0, distanceFraction);
    let inclination = radians(mix(30.0, maximumInclination, branchRandom(seed)));
    let azimuth = branchRandom(seed + 1u) * 6.2831853;
    let direction = forward * cos(inclination) + (side * cos(azimuth) + up * sin(azimuth)) * sin(inclination);

    var minimumLength = params.secondaryMinLength;
    var maximumLength = params.secondaryMaxLength;
    if (parent.order == 1u) {
        minimumLength = params.tertiaryMinLength;
        maximumLength = params.tertiaryMaxLength;
    }
    let branchLength = parent.start.w * mix(minimumLength, maximumLength, branchRandom(seed + 2u));
    let endpoint = root.position.xyz + direction * branchLength;

    var nodeStart = PRIMARY_NODES + (channelIndex - 1u) * SECONDARY_NODES;
    var nodeCapacity = SECONDARY_NODES;
    var attractorStart = PRIMARY_ATTRACTORS + (channelIndex - 1u) * SECONDARY_ATTRACTORS;
    var attractorCount = SECONDARY_ATTRACTORS;
    var order = 1u;
    if (channelIndex > SECONDARY_CHANNELS) {
        let tertiaryIndex = channelIndex - 1u - SECONDARY_CHANNELS;
        nodeStart = PRIMARY_NODES + SECONDARY_CHANNELS * SECONDARY_NODES + tertiaryIndex * TERTIARY_NODES;
        nodeCapacity = TERTIARY_NODES;
        attractorStart = PRIMARY_ATTRACTORS + SECONDARY_CHANNELS * SECONDARY_ATTRACTORS + tertiaryIndex * TERTIARY_ATTRACTORS;
        attractorCount = TERTIARY_ATTRACTORS;
        order = 2u;
    }
    channels[channelIndex] = LightningChannel(
        vec4f(root.position.xyz, branchLength), vec4f(endpoint, 1.0),
        nodeStart, nodeCapacity, 1u, RUNNING,
        attractorStart, attractorCount, rootIndex, order
    );
    nodes[nodeStart] = LightningNode(root.position, rootIndex, channelIndex, root.depth, 1u);

    let envelopeForward = normalize(endpoint - root.position.xyz);
    let envelopeSide = perpendicular(envelopeForward);
    let envelopeUp = cross(envelopeSide, envelopeForward);
    let radius = max(channelDeletionRadius(channels[channelIndex]) * 2.0, min(2.0, branchLength * 0.25));
    for (var index = 0u; index + 1u < attractorCount; index++) {
        let attractorSeed = seed + index * 13u + 11u;
        let t = branchRandom(attractorSeed);
        let angle = branchRandom(attractorSeed + 1u) * 6.2831853;
        let r = radius * sqrt(branchRandom(attractorSeed + 2u));
        let position = mix(root.position.xyz, endpoint, t) +
            r * (envelopeSide * cos(angle) + envelopeUp * sin(angle));
        attractors[attractorStart + index].position = vec4f(position, 1.0);
    }
    attractors[attractorStart + attractorCount - 1u].position = vec4f(endpoint, 1.0);
}

@compute @workgroup_size(1)
fn prepareSecondary() {
    state.secondaryCount = 0u;
    if (channels[0].status != REACHED) {
        return;
    }
    var roots: array<u32, SECONDARY_CHANNELS>;
    var candidateCount = 0u;
    for (var localIndex = 1u; localIndex + 1u < channels[0].nodeCount; localIndex++) {
        if (branchRandom(localIndex * 37u) < params.secondaryProbability) {
            candidateCount++;

            if (candidateCount <= SECONDARY_CHANNELS) {
                roots[candidateCount - 1u] = localIndex;
            } else {
                let slot = u32(branchRandom(localIndex * 7919u + 17u) * f32(candidateCount));
                if (slot < SECONDARY_CHANNELS) {
                    roots[slot] = localIndex;
                }
            }
        }
    }
    state.secondaryCount = min(candidateCount, SECONDARY_CHANNELS);
    for (var index = 1u; index < state.secondaryCount; index++) {
        let root = roots[index];
        var slot = index;
        while (slot > 0u) {
            if (roots[slot - 1u] <= root) {
                break;
            }
            roots[slot] = roots[slot - 1u];
            slot--;
        }
        roots[slot] = root;
    }
    for (var index = 0u; index < state.secondaryCount; index++) {
        prepareBranch(index + 1u, 0u, roots[index]);
    }
}

@compute @workgroup_size(1)
fn growSecondary(@builtin(global_invocation_id) id: vec3u) {
    if (id.x < state.secondaryCount) {
        growBatch(1u + id.x);
    }
}

@compute @workgroup_size(1)
fn prepareTertiary() {
    state.tertiaryCount = 0u;
    var roots: array<u32, TERTIARY_CHANNELS>;
    var parents: array<u32, TERTIARY_CHANNELS>;
    var candidateCount = 0u;
    for (var parentIndex = 1u; parentIndex <= state.secondaryCount; parentIndex++) {
        let parent = channels[parentIndex];
        if (parent.status != REACHED) {
            continue;
        }
        for (var localIndex = 1u; localIndex + 1u < parent.nodeCount; localIndex++) {
            let rootIndex = parent.nodeStart + localIndex;
            if (branchRandom(rootIndex * 53u) < params.tertiaryProbability) {
                candidateCount++;
                var slot = candidateCount - 1u;
                if (candidateCount > TERTIARY_CHANNELS) {
                    slot = u32(branchRandom(rootIndex * 7907u + 31u) * f32(candidateCount));
                }
                if (slot < TERTIARY_CHANNELS) {
                    roots[slot] = rootIndex;
                    parents[slot] = parentIndex;
                }
            }
        }
    }
    state.tertiaryCount = min(candidateCount, TERTIARY_CHANNELS);
    for (var index = 0u; index < state.tertiaryCount; index++) {
        let channelIndex = 1u + SECONDARY_CHANNELS + index;
        prepareBranch(channelIndex, parents[index], roots[index]);
    }
}

@compute @workgroup_size(1)
fn growTertiary(@builtin(global_invocation_id) id: vec3u) {
    if (id.x < state.tertiaryCount) {
        growBatch(1u + SECONDARY_CHANNELS + id.x);
    }
}

@compute @workgroup_size(1)
fn summarize() {
    state.nodeCount = 0u;
    state.maximumDepth = 0u;
    state.failedBranches = 0u;
    for (var index = 0u; index < arrayLength(&channels); index++) {
        let channel = channels[index];
        if (channel.status == 0u) {
            continue;
        }
        state.nodeCount += channel.nodeCount;
        let lastNode = channel.nodeStart + channel.nodeCount - 1u;
        state.maximumDepth = max(state.maximumDepth, nodes[lastNode].depth);
        if (index != 0u && channel.status != REACHED) {
            state.failedBranches++;
        }
    }
    let primary = channels[0];

    for (var index = 0u; index < primary.nodeCount; index++) {
        boltPoints.points[index] = nodes[primary.nodeStart + index].position;
    }
    boltPoints.count = primary.nodeCount;
    state.endpointDistance = length(primary.endpoint.xyz - nodes[primary.nodeCount - 1u].position.xyz);
    state.status = 3u;
    if (primary.status == REACHED) {
        state.status = 1u;
    } else if (primary.status == CAPACITY_REACHED) {
        state.status = 2u;
    }
}
