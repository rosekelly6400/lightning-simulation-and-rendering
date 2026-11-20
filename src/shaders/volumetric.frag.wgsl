
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

struct LightTextureSet {
    numElements: u32,
    rowSize: u32,
    cloudTexture: array<f32>
}

struct LightningBoltPoints {
    count: u32,
    // vec4f alignment places the first point at byte 16.
    points: array<vec4f>,
};

@group(${bindGroup_uniforms}) @binding(0) var<uniform> cameraUniforms: CameraUniforms;
@group(${bindGroup_uniforms}) @binding(1) var<storage, read>  cloudTextureSet: CloudTextureSet;
@group(${bindGroup_uniforms}) @binding(2) var<storage, read>  lightGridTextureSet: LightTextureSet;
@group(${bindGroup_uniforms}) @binding(3) var<storage, read>  boltPoints: LightningBoltPoints;

@group(1) @binding(0) var positionTex: texture_2d<f32>;
@group(1) @binding(1) var positionTexSampler: sampler;

struct FragInput
{
    @builtin(position) fragPos: vec4f,
    @location(0) vertPos: vec4f,
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

fn random1(p : f32) -> f32 {
    return fract(sin(p * 127.1) * 43758.5453);
}

fn convertVec3ToCloudTexIndexOriginal(pos: vec3f) -> i32 {
  var halfRow = 0.5*f32(cloudTextureSet.rowSize);
  var factoredPos = pos*6.0;
  return i32(floor(factoredPos.x+halfRow) + floor(factoredPos.y+halfRow)*f32(cloudTextureSet.rowSize) + floor(factoredPos.z+halfRow)*f32(cloudTextureSet.rowSize*cloudTextureSet.rowSize));
}

fn convertVec3ToCloudTexIndex(pos: vec3f) -> i32 {
  return i32(floor(pos.x) + floor(pos.y)*f32(cloudTextureSet.rowSize) + (floor(pos.z)*f32(cloudTextureSet.rowSize*cloudTextureSet.rowSize) % f32(cloudTextureSet.rowSize*cloudTextureSet.rowSize*cloudTextureSet.rowSize)));
}

fn trilinearInterpolatePosToTexture(pos: vec3f) -> f32 {
  var halfRow = 0.5*f32(cloudTextureSet.rowSize);
  var factoredPos = pos*12.0;
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

fn trilinearInterpolatePosToLightTexture(pos: vec3f, index: i32) -> f32 {
  var halfRow = 0.5*f32(lightGridTextureSet.rowSize);
  var factoredPos = pos*12.0;
  var flooredPos = vec3(floor(factoredPos.x+halfRow), floor(factoredPos.y+halfRow), floor(factoredPos.z+halfRow));

  // Prevent Tiling
  if(flooredPos.x > f32(lightGridTextureSet.rowSize) || flooredPos.y > f32(lightGridTextureSet.rowSize) || flooredPos.z > f32(lightGridTextureSet.rowSize) ||
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
  var interp_100 = mix(lightGridTextureSet.cloudTexture[corner_000], lightGridTextureSet.cloudTexture[corner_100], x_lerp);
  var interp_101 = mix(lightGridTextureSet.cloudTexture[corner_001], lightGridTextureSet.cloudTexture[corner_101], x_lerp);

  var interp_110 = mix(lightGridTextureSet.cloudTexture[corner_010], lightGridTextureSet.cloudTexture[corner_110], x_lerp);
  var interp_111 = mix(lightGridTextureSet.cloudTexture[corner_011], lightGridTextureSet.cloudTexture[corner_111], x_lerp);

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
    let maxY = 7.0;
    let maxX = 7.0;
    let noiseLimitAugmentY = 0.4 * (abs(currPos.y)/maxY)*(abs(currPos.y)/maxY);
    let noiseLimitAugmentX = 0.3 * (abs(currPos.x)/maxX)*(abs(currPos.x)/maxX);
    let noiseLimitAugmentZ = 0.3 * (abs(currPos.z)/maxX)*(abs(currPos.z)/maxX);
    var totalAugment = max(noiseLimitAugmentY, noiseLimitAugmentX);
    totalAugment = max(totalAugment, noiseLimitAugmentZ);
    if (currPos.y > -maxY && currPos.y < maxY ) {
      if(noiseVal > 0.4+totalAugment) {
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
  var finalCloudColor = vec3(0.05,0.14,0.23);

  let lightningPos = textureSample(positionTex, positionTexSampler, fragPosUV);
  if(lightningPos.a > 0.0) {
    let lightningDistToCam = distance(lightningPos.xyz, cameraUniforms.cameraPos.xyz);
    maxRayMarchDistance = min(distance(lightningPos.xyz, cameraUniforms.cameraPos.xyz), maxRayMarchDistance);
  }

  

  // adaptive ray marching variables
  var outside_cloud_stepFactor = 0.1;
  var inside_cloud_stepFactor = 0.04;

  let rayOrigin = cameraUniforms.cameraPos.xyz;
  let rayDir = normalize(in.vertPos.xyz - rayOrigin).xyz;

  let lightPos = vec3(0.0,25.0,0.0);

  var stepFactor = outside_cloud_stepFactor;
  var currMarchPos = rayOrigin + rayDir*0.001;
  

  var occlusionFactor = 1.0;  // along primary ray
  var accumulatedDensity = 0.0; //used to early terminate ray at max density
  var dx = 0.9; // cloud density (uniform across cloud for now)
  var lg = inside_cloud_stepFactor;  // length of both primary and shadow ray step

  var css = vec3(0.6, 0.6, 0.6); // cloud base color

  var lightningPointsArray = array<vec3f, 2>();
  var lightningPointsArraySize = 2;
  //lightningPointsArray[0] = boltPoints.points[0].xyz;
  // lightningPointsArray[1] = vec3(0.0,-5.0,0.0);

  var jumpSize = i32(boltPoints.count) / lightningPointsArraySize;
  for(var boltIndex = 0; boltIndex < lightningPointsArraySize; boltIndex++) {
    var currIndex = jumpSize * boltIndex;
    currIndex = min(currIndex, i32(boltPoints.count-1));
    lightningPointsArray[boltIndex] = boltPoints.points[currIndex].xyz;
  }
  // lightningPointsArray[0] = boltPoints.points[0].xyz;
  // lightningPointsArray[1] = boltPoints.points[1].xyz;
  // lightningPointsArray[0] = boltPoints.points[2].xyz;
  // lightningPointsArray[1] = boltPoints.points[3].xyz;
  

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
      // TODO: For each light, do this iteration and add to clouds

      // basic lighting for "sun"
      occlusionFactor *= exp(-1.0 * dx *lg);
      // cast shadow ray
      var currMarchPos_ShadowRay = currMarchPos;
      var shadowRayDir = normalize(lightPos - currMarchPos);
      var txss = 0.0; // measure occlusion along shadow ray
      var dv = dot(rayDir, shadowRayDir); // dot between primary and shadow ray vectors
      // This is what will be stored in lighting grid
      var gridIndex = convertVec3ToCloudTexIndex(currMarchPos);
      var currPosSSContribution = trilinearInterpolatePosToLightTexture(currMarchPos, 0);
      
      // MULTI SCATTERING USING PRECOMPUTED GRID
      // let n = 3; // number of points to sample for multi scattering
      // var txms = 0.0001;
      // for(var k = 0; k < n; k++) {
      //   // calculate random point to sample
      //   var randomPoint = currMarchPos + (2.0 * random3(vec3(currMarchPos.x + f32(k), currMarchPos.y + f32(k), currMarchPos.z + f32(k))) - vec3(1.0, 1.0, 1.0));
      //   var txkss = trilinearInterpolatePosToLightTexture(randomPoint, 0);
      //   var avg_d = dx;
      //   if(isInsideCloud(randomPoint) <= 0.0) {
      //     avg_d = dx*0.5;
      //   }
      //   txms += distance(currMarchPos, randomPoint)*dx + txkss;
      // }
      // txss = txms;

      //SINGLE SCATTERING NAIVE BELOW
      // for(var j = 0; j < 17; j++) {
      //   var shadowRayCloudSample = isInsideCloud(currMarchPos_ShadowRay);
      //   if (shadowRayCloudSample > 0.0) {
      //     txss += dx *lg;
      //   }
      //   currMarchPos_ShadowRay += shadowRayDir*stepFactor;
      // }

      // SINGLE SCATTERING USING GRID
      txss = currPosSSContribution;
      
      var dp = 10.0 / txss;
      var L = 0.0795774 * dp * pow(0.5 + 0.5 * dv, dp); // 1/4pi * dp
      var s = 1.0;
      var lb = exp(-1.0*txss);
      var ixss = L + lb;
      

      // add to total color
      finalCloudColor += occlusionFactor*css*ixss*(1.0-exp(-1.0 * dx *lg))*0.5;


      // iterate through lightning point lights and add to cloud
      for(var p = 0; p < lightningPointsArraySize; p++) {
        var currLightningNodePos = lightningPointsArray[p];
        currMarchPos_ShadowRay = currMarchPos;
        shadowRayDir = normalize(currLightningNodePos - currMarchPos);
        txss = 0.0; // measure occlusion along shadow ray
        dv = dot(rayDir, shadowRayDir); // dot between primary and shadow ray vectors
        // This is what will be stored in lighting grid
        gridIndex = convertVec3ToCloudTexIndex(currMarchPos);
        currPosSSContribution = trilinearInterpolatePosToLightTexture(currMarchPos, 0);
        

        //SINGLE SCATTERING NAIVE BELOW
        for(var j = 0; j < 17; j++) {
          var shadowRayCloudSample = isInsideCloud(currMarchPos_ShadowRay);
          if (shadowRayCloudSample > 0.0) {
            txss += dx *lg;
          }
          currMarchPos_ShadowRay += shadowRayDir*stepFactor;
        }
        
        dp = 10.0 / txss;
        L = 0.0795774 * dp * pow(0.5 + 0.5 * dv, dp); // 1/4pi * dp
        s = 1.0;
        lb = exp(-1.0*txss);
        ixss = L + lb;
        

        // add to total color
        finalCloudColor += occlusionFactor*css*ixss*(1.0-exp(-1.0 * dx *lg))*0.4;
      }


      // early ray termination if max density reached
      // COMMENT OUT BELOW TO REMOVE EARLY RAY TERMINATION
      accumulatedDensity += dx *lg;
      if(accumulatedDensity > 3.0) {
        break;
      }
    }

    currMarchPos += rayDir*stepFactor;
    currDistFromCamera = distance(currMarchPos, rayOrigin);
  }

  if(lightningPos.a > 0.0) {
    let lightningOcclusionFactor = (1.0 - (accumulatedDensity/3.0));
    finalCloudColor += vec3(0.7,0.5,1.0)*lightningOcclusionFactor;
  }

  return vec4(finalCloudColor.xyz, 1.0);
  
}