struct CloudTextureSet {
    numElements: u32,
    rowSize: u32,
    cloudTexture: array<f32>
}

@group(${bindGroup_uniforms}) @binding(0) var<storage, read_write> cloudTextureSet: CloudTextureSet;
@group(${bindGroup_uniforms}) @binding(1) var<uniform> time: f32;


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

fn PerlinNoise(uvw: vec3f) -> f32 
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



@compute
@workgroup_size(${workgroupSize})
fn main(@builtin(global_invocation_id) globalIdx: vec3u) {
    let cloudTexElementIdx = globalIdx.x;
    if (cloudTexElementIdx >= cloudTextureSet.numElements) {
        return;
    }

    let scaledTime = time / 5000.f;

    let x = cloudTexElementIdx % cloudTextureSet.rowSize;
    let y = floor(f32((cloudTexElementIdx/cloudTextureSet.rowSize)% cloudTextureSet.rowSize));
    let z = floor(f32(cloudTexElementIdx/(cloudTextureSet.rowSize*cloudTextureSet.rowSize)));
    let position = vec3(f32(x),f32(y),f32(z));

    var worley = WorleyNoise3D(position.xyz /1.0, 0.1);
    var perlin = PerlinNoise(position.xyz /60.0);
    var fbm_freq = 0.02;
    var fbmVal = fbm3D(position.x*fbm_freq, position.y*fbm_freq, position.z*fbm_freq);

    var arrayVal = (1.0 - worley)*perlin + 0.8*perlin + 1.5*fbmVal;
    cloudTextureSet.cloudTexture[cloudTexElementIdx] = fbmVal;

    
}
