varying float vNoise;
varying vec2 vUv;
uniform sampler2D uImage;
uniform float time;
uniform vec2 uvScale;
uniform vec2 uvOffset;



void main()	{

    // apply aspect-cover transform
    vec2 uv = vUv * uvScale + uvOffset;
    vec4 oceanView = texture2D(uImage, uv);


    gl_FragColor = oceanView;
    gl_FragColor.rgb += 0.05*vec3(vNoise);
}