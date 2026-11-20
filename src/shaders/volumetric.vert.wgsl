
struct CameraUniforms {
    viewProjMat: mat4x4f,
    viewMat: mat4x4f,
    invProjMat: mat4x4f,
    nClip: f32,
    fClip: f32,
    screenX: f32,
    screenY: f32,
    cameraUp: vec4f,
    cameraRight: vec4f,
    cameraFront: vec4f,
    cameraPos: vec4f,
    pixelSize: vec4f
}

struct VertOutput
{
    @builtin(position) fragPos: vec4f,
    @location(0) vertPos: vec4f,
}

@group(${bindGroup_uniforms}) @binding(0) var<uniform> cameraUniforms: CameraUniforms;


@vertex
fn main(
  @builtin(vertex_index) VertexIndex : u32
) -> VertOutput {

  // render triangle covering camera
  var pos = array<vec3<f32>, 3>(
    (cameraUniforms.cameraPos + cameraUniforms.cameraFront + 2.5 * cameraUniforms.cameraUp).xyz,
    (cameraUniforms.cameraPos + cameraUniforms.cameraFront + 1.5 * cameraUniforms.cameraRight - 1.5 * cameraUniforms.cameraUp).xyz,
    (cameraUniforms.cameraPos + cameraUniforms.cameraFront - 1.5 * cameraUniforms.cameraRight - 1.5 * cameraUniforms.cameraUp).xyz
  );

  var out: VertOutput;
  out.fragPos =  cameraUniforms.viewProjMat * vec4<f32>(pos[VertexIndex], 1.0);
  out.vertPos = vec4<f32>(pos[VertexIndex], 1.0);
  return out;
}