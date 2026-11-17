
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

struct CloudTextureSet {
    numElements: u32,
    rowSize: u32,
    cloudTexture: array<f32>
}

@group(${bindGroup_uniforms}) @binding(0) var<uniform> cameraUniforms: CameraUniforms;
@group(${bindGroup_uniforms}) @binding(1) var<storage, read>  cloudTextureSet: CloudTextureSet;

@group(1) @binding(0) var positionTex: texture_2d<f32>;
@group(1) @binding(1) var positionTexSampler: sampler;

struct FragInput
{
    @builtin(position) fragPos: vec4f
}

fn random3( p : vec3f) -> vec3f {
    return fract(
                sin(
                    vec3(
                        dot(p, vec3(127.1, 311.7, 382.1)),
                        dot(p, vec3(269.5,183.3f, 472.2)),
                        dot(p, vec3(129.5,122.3f, 264.1))
                    ))
                 * 43758.5453f);
}

fn surflet(p: vec3f, gridPoint: vec3f) -> f32
{
    var t2 = abs(p - gridPoint);


    var tX = 1 - 6 * pow(t2.x, 5.0) + 15 * pow(t2.x, 4.0) - 10 * pow(t2.x, 3.0);
    var tY = 1 - 6 * pow(t2.y, 5.0) + 15 * pow(t2.y, 4.0) - 10 * pow(t2.y, 3.0);
    var tZ = 1 - 6 * pow(t2.z, 5.0) + 15 * pow(t2.z, 4.0) - 10 * pow(t2.z, 3.0);

    var gradient = random3(gridPoint) * 2.f - vec3(1.f);
    var diff = p - gridPoint;

    var height = dot(diff, gradient);
    return height * tX * tY * tZ;
}

fn PerlinNoise(uvw: vec3f) -> f32 // assumes the point
{
    var surfletSum = 0.f;
    for(var dx = 0; dx <= 1; dx++) 
    {
      for(var dy = 0; dy <= 1; dy++) {
            for (var dz = 0; dz <= 1; dz++) {
                surfletSum += surflet(uvw, floor(uvw) + vec3f(f32(dx), f32(dy), f32(dz))); // we are checking for a point uvw
            }
      }
    }
    return surfletSum;
}

fn noise2D(pos: vec2f) -> f32 {
  return fract(sin( dot(pos, vec2f(127.1, 311.7)) )
    * 43758.5453);

}

fn noise3D(pos: vec3f) -> f32 {
  return fract(sin( dot(pos, vec3f(127.1, 311.7, 251.7)) )
    * 43758.5453);

}


fn WorleyNoise(uvInput: vec3f) -> f32 {
  let uv = uvInput * 10.0;
  let uvInt = floor(uv);
  let uvFract = fract(uv);
  var minDist = 1.0; 
  for(var z = -1; z <= 1; z++) {
    for(var y = -1; y <= 1; y++) {
      for(var x = -1; x <= 1; x++) {
        let neighbor = vec3f(f32(x), f32(y), f32(z));
        let point = random3(uvInt + neighbor);
        let diff = neighbor + point - uvFract;
        let dist = length(diff);
        minDist = min(minDist, dist);
      }
    }
  }
  return 1.0;
}

fn interpNoise2D(x: f32, y: f32) ->f32 {
  var intX = floor(x);
  var fractX = fract(x);
  var intY = floor(y);
  var fractY = fract(y);
  var v1 = noise2D(vec2(intX, intY));
  var v2 = noise2D(vec2(intX + 1, intY));
  var v3 = noise2D(vec2(intX, intY + 1));
  var v4 = noise2D(vec2(intX + 1, intY + 1));
  var i1 = mix(v1, v2, fractX);
  var i2 = mix(v3, v4, fractX);
  return mix(i1, i2, fractY);
}

fn interpNoise3D(x: f32, y: f32, z: f32) ->f32 {
  var intX = floor(x);
  var fractX = fract(x);
  var intY = floor(y);
  var fractY = fract(y);
  var intZ = floor(z);
  var fractZ = fract(z);

  var v1 = noise3D(vec3(intX, intY, intZ));
  var v2 = noise3D(vec3(intX + 1, intY, intZ));
  var v3 = noise3D(vec3(intX, intY + 1, intZ));
  var v4 = noise3D(vec3(intX + 1, intY + 1, intZ));

  var v5 = noise3D(vec3(intX, intY, intZ + 1));
  var v6 = noise3D(vec3(intX + 1, intY, intZ + 1));
  var v7 = noise3D(vec3(intX, intY + 1, intZ + 1));
  var v8 = noise3D(vec3(intX + 1, intY + 1, intZ + 1));

  var i1 = mix(v1, v2, fractX);
  var i2 = mix(v3, v4, fractX);

  var i3 = mix(v5, v6, fractX);
  var i4 = mix(v7, v8, fractX);
  
  var i5 = mix(i1, i2, fractY);
  var i6 = mix(i3, i4, fractY);

  return mix(i5, i6, fractZ);
}

fn fbm(x: f32, y: f32) ->f32 {
  var total = 0.0f;
  var persistence = 0.5f;
  var octaves = 8;
  var freq = 2.f;
  var amp = 0.5f;
  for(var i = 1; i <= octaves; i++) {
    total += interpNoise2D(x * freq,
    y * freq) * amp;

    freq *= 2.f;
    amp *= persistence;
  }
  return total;
}

fn fbm3D(x: f32, y: f32, z: f32) ->f32 {
  var total = 0.0f;
  var persistence = 0.5f;
  var octaves = 8;
  var freq = 0.5f;
  var amp = 0.5f;
  for(var i = 1; i <= octaves; i++) {
    total += interpNoise3D(x * freq,
    y * freq, z * freq) * amp;

    freq *= 2.f;
    amp *= persistence;
  }
  return total;
}

fn WorleyNoise3D( uvw : vec3f,  scale : f32) -> f32{
    var uv = uvw* scale; 
    var uvInt = floor(uv);
    var uvFract = fract(uv);
    var minDist = 2.0; 
    for(var z = -1; z <= 1; z++) {
      for(var y = -1; y <= 1; y++) {
          for(var x = -1; x <= 1; x++) {
              var neighbor = vec3(f32(x), f32(y), f32(z));
              var point = random3(uvInt + neighbor);
              //point = 0.5 + 0.5*sin(u_Time * 0.02 + 6.283*point);
              var diff = neighbor + point - uvFract;
              var dist = length(diff);
              minDist = min(minDist, dist);
          }
      }
    }
    return minDist;
}


fn convertVec3ToCloudTexIndexOriginal(pos: vec3f) -> i32 {
  var halfRow = 0.5*f32(cloudTextureSet.rowSize);
  var factoredPos = pos*6.0;
  return i32(floor(factoredPos.x+halfRow) + floor(factoredPos.y+halfRow)*f32(cloudTextureSet.rowSize) + floor(factoredPos.z+halfRow)*f32(cloudTextureSet.rowSize*cloudTextureSet.rowSize));
}

fn convertVec3ToCloudTexIndex(pos: vec3f) -> i32 {
  // var halfRow = 0.5*f32(cloudTextureSet.rowSize);
   var factoredPos = pos*1.0;
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
    //let noiseVal = cloudTextureSet.cloudTexture[convertVec3ToCloudTexIndexOriginal(currPos)];
    let maxY = 8.0;
    let noiseLimitAugmentY = 0.2 * (abs(currPos.y)/maxY);
    if (currPos.y > -maxY && currPos.y < maxY ) {
      if(noiseVal > 0.5+noiseLimitAugmentY) {
        return noiseVal;
      }

      // var worley = WorleyNoise3D(currPos.xyz /1.0, 0.6);
      // var perlin = PerlinNoise(currPos.xyz /4.0);
      // var fbmVal = fbm3D(currPos.x, currPos.y, currPos.z);

      // if(fbm3D(currPos.x, currPos.y, currPos.z) > 0.5+noiseLimitAugmentY) {
      //   return 1.0;
      // }
      // if(PerlinNoise(currPos.xyz /4.0) > 0.3) {
      //   return true;
      // }
      // if(WorleyNoise3D(currPos.xyz /1.0, 0.6) < 0.5) {
      //   return true;
      // }

      // if((1.0 - worley)*perlin + perlin*fbmVal + fbmVal > 0.8) {
      //   return true;
      // }

    }
    return 0.0;
}

@fragment
fn main(in: FragInput) -> @location(0) vec4<f32> {

  let fragPosUV = vec2(in.fragPos.x/cameraUniforms.screenX, in.fragPos.y/cameraUniforms.screenY);

  var maxRayMarchDistance = 30.0;
  var finalCloudColor = vec3(0.1,0.3,0.55);

  let lightningPos = textureSample(positionTex, positionTexSampler, fragPosUV);
  if(lightningPos.a > 0.0) {
    let lightningDistToCam = distance(lightningPos.xyz, cameraUniforms.cameraPos.xyz);
    maxRayMarchDistance = min(distance(lightningPos.xyz, cameraUniforms.cameraPos.xyz), maxRayMarchDistance);
  }

  

  // adaptive ray marching variables
  var outside_cloud_stepFactor = 0.1;
  var inside_cloud_stepFactor = 0.04;

  let rayOrigin = cameraUniforms.cameraPos.xyz;
  let rayRightShift = cameraUniforms.cameraRight * cameraUniforms.pixelSize.x * (in.fragPos.x - cameraUniforms.screenX*0.5);
  let rayUpShift = cameraUniforms.cameraUp * cameraUniforms.pixelSize.y * (in.fragPos.y - cameraUniforms.screenY*0.5);

  // maybe rayRightShift shouldn't be positive ? (currently positive because controls are unintuitive otherwise)
  let rayDir = normalize(cameraUniforms.cameraFront + rayRightShift - rayUpShift).xyz;
  let lightPos = vec3(0.0,20.0,0.0);

  let sphereCenter = vec3(0.0,0.0,0.0);
  var stepFactor = outside_cloud_stepFactor;
  var currMarchPos = rayOrigin + rayDir*0.001;
  

  var occlusionFactor = 1.0;  // along primary ray
  var accumulatedDensity = 0.0; //used to early terminate ray at max density
  var dx = 0.9; // cloud density (uniform across cloud for now)
  var lg = length(rayDir*inside_cloud_stepFactor);  // length of both primary and shadow ray step

  var css = vec3(0.4, 0.4, 0.4); // cloud base color

  // march along each ray untiwl max distance
  var currDistFromCamera = distance(currMarchPos, rayOrigin);
  while(currDistFromCamera < maxRayMarchDistance) {
    
    let primaryRayCloudSample = isInsideCloud(currMarchPos);
    // if outside cloud until this point and now inside cloud, switch to smaller step size
    // COMMENT OUT BELOW AND SET stepFactor TO inside_cloud_stepFactor TO REMOVE VARIABLE STEP SIZE
    if(primaryRayCloudSample > 0.0 && stepFactor > inside_cloud_stepFactor + 0.001) {
      currMarchPos -= rayDir*stepFactor;
      stepFactor = inside_cloud_stepFactor;
      continue;
    }
    else if (primaryRayCloudSample > 0.0) {
      occlusionFactor *= exp(-1.0 * dx *lg);
      // cast shadow ray
      var currMarchPos_ShadowRay = currMarchPos;
      let shadowRayDir = normalize(lightPos - currMarchPos);
      var txss = 0.0; // measure occlusion along shadow ray
      var dv = dot(rayDir, shadowRayDir); // dot between primary and shadow ray vectors
      for(var j = 0; j < 17; j++) {
        let shadowRayCloudSample = isInsideCloud(currMarchPos_ShadowRay);
        if (shadowRayCloudSample > 0.0) {
          txss += dx *lg;
        }
        currMarchPos_ShadowRay += shadowRayDir*stepFactor;
      }
      var dp = 10.0 / txss;
      var L = 0.0795774 * dp * pow(0.5 + 0.5 * dv, dp); // 1/4pi * dp
      let s = 1.0;
      var lb = exp(-1.0*txss);
      var ixss = L + lb;
      

      // add to total color
      finalCloudColor += occlusionFactor*css*ixss*(1.0-exp(-1.0 * dx *lg))*0.8;

      // early ray termination if max density reached
      // COMMENT OUT BELOW TO REMOVE EARLY RAY TERMINATION
      accumulatedDensity += dx *lg;
      if(accumulatedDensity > 3.5) {
        break;
      }
    }

    //stepFactor += 0.0005;

    currMarchPos += rayDir*stepFactor;
    currDistFromCamera = distance(currMarchPos, rayOrigin);
  }

  if(lightningPos.a > 0.0) {
    let lightningOcclusionFactor = (1.0 - (accumulatedDensity/3.5));
    finalCloudColor += vec3(0.6,0.0,1.0)*lightningOcclusionFactor;
  }

  return vec4(finalCloudColor.xyz, 1.0);
  
}