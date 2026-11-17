struct CloudTextureSet {
    numElements: u32,
    rowSize: u32,
    cloudTexture: array<f32>
}

@group(${bindGroup_uniforms}) @binding(0) var<storage, read_write> lightGridTextureSet: CloudTextureSet;
@group(${bindGroup_uniforms}) @binding(1) var<uniform> time: f32;
@group(${bindGroup_uniforms}) @binding(2) var<storage, read> cloudTextureSet: CloudTextureSet;


fn convertVec3ToCloudTexIndex(pos: vec3f) -> i32 {
  return i32(floor(pos.x) + floor(pos.y)*f32(cloudTextureSet.rowSize) + (floor(pos.z)*f32(cloudTextureSet.rowSize*cloudTextureSet.rowSize) % f32(cloudTextureSet.rowSize*cloudTextureSet.rowSize*cloudTextureSet.rowSize)));
}

fn trilinearInterpolatePosToTexture(pos: vec3f) -> f32 {
  var halfRow = 0.5*f32(cloudTextureSet.rowSize);
  var factoredPos = pos*14.0;
  var flooredPos = vec3(floor(factoredPos.x+halfRow), floor(factoredPos.y+halfRow), floor(factoredPos.z+halfRow));

  // Prevent Tiling
  if(flooredPos.x > f32(cloudTextureSet.rowSize) || flooredPos.y > f32(cloudTextureSet.rowSize) || flooredPos.z > f32(cloudTextureSet.rowSize) ||
  flooredPos.x < 0.0 || flooredPos.y < 0.0 || flooredPos.z < 0.0) {
    return 0.0;
  }

  var corner_000 = convertVec3ToCloudTexIndex(vec3(flooredPos.x, flooredPos.y, flooredPos.z));
  var corner_100 = convertVec3ToCloudTexIndex(vec3(flooredPos.x+1, flooredPos.y, flooredPos.z));

  var corner_001 = convertVec3ToCloudTexIndex(vec3(flooredPos.x, flooredPos.y, flooredPos.z+1));
  var corner_101 = convertVec3ToCloudTexIndex(vec3(flooredPos.x+1, flooredPos.y, flooredPos.z+1));

  var corner_010 = convertVec3ToCloudTexIndex(vec3(flooredPos.x, flooredPos.y+1, flooredPos.z));
  var corner_110 = convertVec3ToCloudTexIndex(vec3(flooredPos.x+1, flooredPos.y+1, flooredPos.z));

  var corner_011 = convertVec3ToCloudTexIndex(vec3(flooredPos.x, flooredPos.y+1, flooredPos.z+1));
  var corner_111 = convertVec3ToCloudTexIndex(vec3(flooredPos.x+1, flooredPos.y+1, flooredPos.z+1));

  var x_lerp = factoredPos.x- floor(factoredPos.x);
  var interp_100 = mix(cloudTextureSet.cloudTexture[corner_000], cloudTextureSet.cloudTexture[corner_100], x_lerp);
  var interp_101 = mix(cloudTextureSet.cloudTexture[corner_001], cloudTextureSet.cloudTexture[corner_101], x_lerp);

  var interp_110 = mix(cloudTextureSet.cloudTexture[corner_010], cloudTextureSet.cloudTexture[corner_110], x_lerp);
  var interp_111 = mix(cloudTextureSet.cloudTexture[corner_011], cloudTextureSet.cloudTexture[corner_111], x_lerp);

  var y_lerp = factoredPos.y- floor(factoredPos.y);
  var interp_020 = mix(interp_100, interp_110, y_lerp);
  var interp_022 = mix(interp_101, interp_111, y_lerp);

  var z_lerp = factoredPos.z- floor(factoredPos.z);
  var final_interp = mix(interp_020, interp_022, z_lerp);


  return final_interp;
}

fn isInsideCloud(currPos: vec3f) -> f32 {
    let index = convertVec3ToCloudTexIndex(currPos);
    let noiseVal = trilinearInterpolatePosToTexture(currPos);
    let maxY = 8.0;
    let noiseLimitAugmentY = 0.2 * (abs(currPos.y)/maxY);
    if (currPos.y > -maxY && currPos.y < maxY ) {
      if(noiseVal > 0.5+noiseLimitAugmentY) {
        return noiseVal;
      }

    }
    return 0.0;
}

@compute
@workgroup_size(${workgroupSize})
fn main(@builtin(global_invocation_id) globalIdx: vec3u) {
    let cloudTexElementIdx = globalIdx.x;
    if (cloudTexElementIdx >= lightGridTextureSet.numElements) {
        return;
    }

    let scaledTime = time / 5000.f;



    let x = cloudTexElementIdx % lightGridTextureSet.rowSize;
    let y = floor(f32((cloudTexElementIdx/lightGridTextureSet.rowSize)% lightGridTextureSet.rowSize));
    let z = floor(f32(cloudTexElementIdx/(lightGridTextureSet.rowSize*lightGridTextureSet.rowSize)));
    let position = vec3(f32(x),f32(y),f32(z));

    // XYZ that raycaster will be using
    var halfRow = 0.5*f32(lightGridTextureSet.rowSize);
    var possibleNegativePos = vec3(position.x - halfRow, position.y - halfRow, position.z - halfRow);
    var unfactoredPos = possibleNegativePos / 14.0;


    // BELOW VARS NEED TO MATCH  VOLUMETRIC EXACTLY
    var outside_cloud_stepFactor = 0.1;
    var inside_cloud_stepFactor = 0.02;

    let lightPos = vec3(0.0,5.0,0.0);

    var occlusionFactor = 1.0;  // along primary ray
    var accumulatedDensity = 0.0; //used to early terminate ray at max density
    var dx = 0.4; // cloud density (uniform across cloud for now)
    var lg = inside_cloud_stepFactor;  // length of both primary and shadow ray step

    var currMarchPos_ShadowRay = unfactoredPos;
    let shadowRayDir = normalize(lightPos - currMarchPos_ShadowRay);
    var txss = 0.00001; // measure occlusion along shadow ray, make very small value to avoid dividing by 0.0
    // for multi scattering, create shadow rays starting at N different points
    for(var j = 0; j < 17; j++) {
      let shadowRayCloudSample = isInsideCloud(currMarchPos_ShadowRay);
      if (shadowRayCloudSample > 0.0) {
        txss += dx *lg;
      }
      currMarchPos_ShadowRay += shadowRayDir*inside_cloud_stepFactor;
    }


    lightGridTextureSet.cloudTexture[cloudTexElementIdx] = txss;
}
