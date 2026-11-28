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
    @location(1) lightningPos: vec3f, 
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
fn main(
    @builtin(vertex_index) index: u32
) -> VertexOutput {
    
    let childIndex = index / 6u;
    let corner = index % 6u;
    let child = nodes[childIndex];

    //default positions
    var output: VertexOutput;
    output.position = vec4f(2.0, 2.0, 2.0, 1.0);
    output.color = vec4f(1.0);
    output.lightningPos = vec3f(0.0);

    if (state.status == 0u || child.valid == 0u ||
        child.parentIndex == childIndex ||
        child.parentIndex >= arrayLength(&nodes) ||
        f32(child.depth) > reveal.x) {
        return output;
    }

    var start = nodes[child.parentIndex].position.xyz;
    var end = child.position.xyz;
    var startClip = camera.viewProjMat * vec4f(start, 1.0);
    var endClip = camera.viewProjMat * vec4f(end, 1.0);

    if (startClip.z < 0.0 && endClip.z < 0.0) {
        return output;
    }

    if (startClip.z < 0.0 || endClip.z < 0.0) {
        let t = startClip.z / (startClip.z - endClip.z);
        let clipped = mix(startClip, endClip, t);
        let clippedWorld = mix(start, end, t);
        if (startClip.z < 0.0) {
            startClip = clipped;
            start = clippedWorld;
        } else {
            endClip = clipped;
            end = clippedWorld;
        }
    }

    let screen = vec2f(camera.screenX, camera.screenY);
    let startNdc = startClip.xy / startClip.w;
    let endNdc = endClip.xy / endClip.w;
    let deltaPx = (endNdc - startNdc) * screen * 0.5;
    let lengthPx = length(deltaPx);
    if (lengthPx < 0.001) {
        return output;
    }

    let normalPx = vec2f(-deltaPx.y, deltaPx.x) / lengthPx;
    let widthPx = select(1.0, 4.0, child.channelIndex == 0u);

    var useEnd = false;
    var useRight = false;

    switch corner {
        //T1 parent left
        case 0u: {

        }        
        //T1 parent right
        case 1u: { 
            useRight = true; 
        } 
        //T1child left
        case 2u: { 
            useEnd = true; 
        }   
        //T2 child left
        case 3u: { 
            useEnd = true; 
        }   
        //T2 parent right
        case 4u: { 
            useRight = true; 
        } 
        //T2 child right
        case 5u: {                  
            useEnd = true;
            useRight = true;
        }
        default: {}
    }
    
    let side = select(-1.0, 1.0, useRight);
    let clip = select(startClip, endClip, useEnd);

    let offsetNdc = normalPx * side * (widthPx * 0.5) * (2.0 / screen);
    output.position = vec4f(clip.xy + offsetNdc * clip.w, clip.zw);
    output.lightningPos = select(start, end, useEnd);
    return output;
}

