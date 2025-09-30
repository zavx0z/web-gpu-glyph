// Юниформы для ореола
struct Uniforms {
    mouse: vec2f, // позиция мыши в NDC (-1..1), радиус и ореол (в NDC)
    radius: f32,
    halo: f32,
    resolution: vec2f, // разрешение canvas в пикселях
    _pad: vec2f,
}

@group(0) @binding(0) var<uniform> uni: Uniforms;

// Вершинный шейдер точки (примитив point-list)
@vertex
fn vs_point(@builtin(vertex_index) _i: u32) -> @builtin(position) vec4f {
    return vec4f(0.0, 0.0, 0.0, 1.0);
}

// Фрагментный шейдер точки
@fragment
fn fs_point() -> @location(0) vec4f {
    return vec4f(1.0, 1.0, 1.0, 1.0);
}

// Полноэкранный треугольник для ореола
@vertex
fn vs_full(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  // полноэкранный треугольник
    let pos = array<vec2f, 3>(
        vec2f(-1.0, -1.0),
        vec2f(3.0, -1.0),
        vec2f(-1.0, 3.0),
    );
    return vec4f(pos[i], 0.0, 1.0);
}

// Фрагментный шейдер ореола (прозрачный)
@fragment
fn fs_halo(@builtin(position) fragCoord: vec4f) -> @location(0) vec4f {
  // преобразуем пиксельные координаты в NDC (-1..1), инвертируем Y
    let ndc = vec2f(
        (fragCoord.x / uni.resolution.x) * 2.0 - 1.0,
        -((fragCoord.y / uni.resolution.y) * 2.0 - 1.0)
    );

  // показывать ореол только при наведении (используем _pad.x как флаг hover)
    if uni._pad.x < 0.5 {
        return vec4f(0.0, 0.0, 0.0, 0.0);
    }

  // компенсируем соотношение сторон, чтобы круг был ровным
    let aspect = uni.resolution.x / uni.resolution.y;
    // центр ореола — сама точка в (0,0) NDC
    let delta = vec2f(ndc.x * aspect, ndc.y);
    let d = length(delta);

    if d <= uni.radius {
    // ядро точки — не заливаем ореолом
        return vec4f(0.0, 0.0, 0.0, 0.0);
    }

    if d <= uni.radius + uni.halo {
    // мягкий голубой ореол, плавное затухание
        let t = 1.0 - clamp((d - uni.radius) / uni.halo, 0.0, 1.0);
        return vec4f(0.2 * t, 0.6 * t, 1.0 * t, t);
    }

    return vec4f(0.0, 0.0, 0.0, 0.0);
}
