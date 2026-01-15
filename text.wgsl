struct Params {
    unitsPerEm: f32,
    fontSizePx: f32,
    originPx: vec2<f32>,
    canvasWH: vec2<f32>,
    time: f32,
    padding: f32,
};
  
@group(0) @binding(0) var<uniform> u: Params;
  
struct VSIn {
    @location(0) pos_fu: vec2<f32>,
};
  
struct VSOut {
    @builtin(position) pos: vec4<f32>,
};
  
@vertex
fn vs_main(v: VSIn) -> VSOut {
    let scale = u.fontSizePx / u.unitsPerEm;
  
    // Real-time Geometry Distortion (Sine Wave)
    let freq = 0.003;
    let amp = 200.0; 
    let distortion = sin(u.time * 0.005 + v.pos_fu.y * freq) * amp;
    
    let x_distorted = v.pos_fu.x + distortion;
    let y_distorted = v.pos_fu.y;

    // font units -> pixels
    let x_px = u.originPx.x + x_distorted * scale;
    let y_px = u.originPx.y - y_distorted * scale;
  
    // pixels -> clip
    let x = ((x_px + 0.5) / u.canvasWH.x) * 2.0 - 1.0;
    let y = 1.0 - ((y_px + 0.5) / u.canvasWH.y) * 2.0;
    
    var out: VSOut;
    out.pos = vec4<f32>(x, y, 0.0, 1.0);
    return out;
}
  
@fragment
fn fs_stencil() -> @location(0) vec4<f32> {
    // Output is ignored due to write mask, but must return valid type
    return vec4<f32>(1.0, 0.0, 0.0, 1.0);
}

@fragment
fn fs_cover() -> @location(0) vec4<f32> {
    return vec4<f32>(1.0, 1.0, 1.0, 1.0);
}
