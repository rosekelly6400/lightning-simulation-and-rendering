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
};

struct LightningState {
    nodeCount: u32,
};

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) color: vec4f,
    @location(1) lightningPos: vec3f, // used for position texture generation
};

@group(0) @binding(0)
var<uniform> camera: CameraUniforms;

@group(1) @binding(1)
var<storage, read> nodes: array<LightningNode>;

@group(1) @binding(2)
var<storage, read> state: LightningState;

@vertex
fn boltVertex(
    @builtin(vertex_index) index: u32
) -> VertexOutput {
    let segmentIndex = index / 2u;
    let endpointOffset = index % 2u;

    var output: VertexOutput;
    output.color = vec4f(1.0);

    if (segmentIndex + 1u >= state.nodeCount) {
        output.position = vec4f(2.0, 2.0, 2.0, 1.0);
        return output;
    }

    let nodeIndex = segmentIndex + endpointOffset;

    output.position = camera.viewProjMat * vec4f(nodes[nodeIndex].position.xyz, 1.0);

    output.lightningPos = nodes[nodeIndex].position.xyz;

    return output;
}

