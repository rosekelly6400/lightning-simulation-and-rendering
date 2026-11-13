
struct CameraUniforms {
    viewProjMat: mat4x4f,
    viewMat: mat4x4f,
    invProjMat: mat4x4f,
    nClip: f32,
    fClip: f32,
    screenX: f32,
    screenY: f32
}

struct VertOutput
{
    @builtin(position) fragPos: vec4f
}

@group(${bindGroup_uniforms}) @binding(0) var<uniform> cameraUniforms: CameraUniforms;


@vertex
fn main(
  @builtin(vertex_index) VertexIndex : u32
) -> VertOutput {

  // render triangle covering camera

  var fullscreenPos = array<vec3<f32>, 3>(
    vec3(0.0, 5.0, 0.0),
    vec3(-2.5, -1.0, 0.0),
    vec3(2.5, -1.0, 0.0)
  );

  var out: VertOutput;
  out.fragPos = vec4<f32>(fullscreenPos[VertexIndex], 1.0);
  return out;
}