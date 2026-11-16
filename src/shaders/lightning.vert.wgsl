struct CameraUniforms {
    viewProjMat: mat4x4f,
    viewMat: mat4x4f,
    invProjMat: mat4x4f,
    nClip: f32,
    fClip: f32,
    screenX: f32,
    screenY: f32,
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

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) color: vec4f,
};

@group(0) @binding(0)
var<uniform> camera: CameraUniforms;

@group(1) @binding(1)
var<storage, read> nodes: array<LightningNode>;

@group(1) @binding(2)
var<storage, read> state: LightningState;

@group(1) @binding(3)
var<uniform> reveal: vec4f;

@vertex
fn boltVertex(
    @builtin(vertex_index) index: u32
) -> VertexOutput {
    let childIndex = index / 2u;
    let endpointOffset = index % 2u;

    var output: VertexOutput;
    let child = nodes[childIndex];

    output.color = vec4f(1.0); // Primary: white

    if (child.channelIndex >= 1u && child.channelIndex <= 16u) {
        output.color = vec4f(0.0, 1.0, 1.0, 1.0); // Secondary: cyan
    } else if (child.channelIndex >= 17u) {
        output.color = vec4f(1.0, 0.3, 0.8, 1.0); // Tertiary: pink
    }

    if (state.status == 0u || child.valid == 0u || child.parentIndex == childIndex ||
        child.parentIndex >= arrayLength(&nodes) || f32(child.depth) > reveal.x) {
        output.position = vec4f(2.0, 2.0, 2.0, 1.0);
        return output;
    }

    // Both vertices belong to one child-parent edge, even across channel ranges.
    let nodeIndex = select(child.parentIndex, childIndex, endpointOffset == 1u);

    output.position = camera.viewProjMat * vec4f(nodes[nodeIndex].position.xyz, 1.0);

    return output;
}

