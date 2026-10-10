import * as C from 'cesium';
import { getProjectTime } from '../state/projectTime';
/** Explicit study weather. Animation uses project time and pauses with the study. */
export function rainStage(intensity = 1): C.PostProcessStage {
  return new C.PostProcessStage({ name: 'drip-rain', uniforms: { time: () => window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : Date.parse(getProjectTime().instant) / 1000 % 3600, intensity: Math.max(0, Math.min(1, intensity)) }, fragmentShader: `
    uniform sampler2D colorTexture;
    uniform float time;
    uniform float intensity;
    in vec2 v_textureCoordinates;
    float hash(float v) { return fract(sin(v*127.1)*43758.5453); }
    void main() {
      vec4 scene=texture(colorTexture,v_textureCoordinates);
      vec2 uv=v_textureCoordinates*vec2(mix(70.0,150.0,intensity),60.0);uv.x+=uv.y*.15;
      float column=floor(uv.x), speed=12.0+hash(column)*10.0;
      float drop=fract(uv.y+time*speed+hash(column+2.0)*13.0);
      float streak=(1.0-smoothstep(0.0,.06,abs(fract(uv.x)-.5)))*(1.0-smoothstep(0.0,.22,drop));
      float luminance=dot(scene.rgb,vec3(.2126,.7152,.0722));
      vec3 wet=mix(scene.rgb,vec3(luminance),intensity*.25)*(1.0-intensity*.22);
      wet=mix(wet,vec3(.38,.43,.47),intensity*.08);
      out_FragColor=vec4(mix(wet,vec3(.72,.8,.87),streak*.55*intensity),scene.a);
    }` });
}
