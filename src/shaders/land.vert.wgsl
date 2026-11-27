
struct CameraUniforms {
    viewProjMat: mat4x4f,
    viewMat: mat4x4f,
    invProjMat: mat4x4f,
    nClip: f32,
    fClip: f32,
    screenX: f32,
    screenY: f32
}

struct CloudTextureSet {
    numElements: u32,
    rowSize: u32,
    cloudTexture: array<f32>
}

@group(${bindGroup_uniforms}) @binding(0) var<uniform> cameraUniforms: CameraUniforms;
@group(${bindGroup_uniforms}) @binding(1) var<storage, read>  landTextureSet: CloudTextureSet;


@vertex
fn main(
  @builtin(vertex_index) VertexIndex : u32
) -> @builtin(position) vec4<f32> {

  // render world space triangle in x = 0 plane

  // var pos = array<vec3<f32>, 3>(
  //   vec3(0.0, 3.0, 0.0),
  //   vec3(0.0, 1.0, -1.5),
  //   vec3(0.0, 1.0, 1.5)
  // );
  var pos = array<vec3<f32>, 6>(
    vec3(0.0, 0.0, 0.0),
    vec3(1.0, 0.0, 0.0),
    vec3(0.0, 0.0, 1.0),

    vec3(1.0, 0.0, 1.0),
    vec3(1.0, 0.0, 0.0),
    vec3(0.0, 0.0, 1.0)
  );
  const rowLength = 10;
  var triIndex = VertexIndex %6;
  var posXFactor = (VertexIndex/6)%rowLength;
  var posZFactor = VertexIndex/(rowLength*6);

  var vertPos = pos[triIndex] + f32(posXFactor) * vec3(1.0, 0.0, 0.0)  + f32(posZFactor) * vec3(0.0, 0.0, 1.0);

  // const landbufferCellSize = 0.1; 
  // const landbufferRowLength = landTextureSet.rowSize; 
  // const originIndex = floor(landbufferRowLength * 0.5)*landbufferRowLength + floor(landbufferRowLength * 0.5);

  return cameraUniforms.viewProjMat * vec4<f32>(vertPos, 1.0);
}