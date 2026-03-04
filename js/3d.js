import * as THREE from 'three';
import { gsap } from 'gsap';
import Scroll from './scroll.js';


const FontFaceObserver = window.FontFaceObserver;

export default class Sketch {
	constructor(options) {
		this.time = 0;
		this.container = options.dom;

		this.scene = new THREE.Scene();

		this.width = this.container.offsetWidth;
		this.height = this.container.offsetHeight;

		// Camera
		this.camera = new THREE.PerspectiveCamera(70, this.width / this.height, 100, 2000);
		this.camera.position.z = 600;
		this.camera.fov = 2 * Math.atan((this.height / 2) / 600) * (180 / Math.PI);

		this.renderer = new THREE.WebGLRenderer({
			antialias: true,
			alpha: true,
		});
		this.renderer.setPixelRatio(window.devicePixelRatio);
		this.renderer.setSize(this.width, this.height);
		this.container.appendChild(this.renderer.domElement);

		// Preload fonts (if needed)
		const fontOpen = new Promise(resolve => {
			new FontFaceObserver("Open Sans").load().then(resolve);
		});
		const fontPlayfair = new Promise(resolve => {
			new FontFaceObserver("Playfair Display").load().then(resolve);
		});

		// Load shaders
		const loadShadersPromise = this.loadShaders();

		// Video loading promise – waits for canplaythrough or timeout
		const loadVideoPromise = new Promise((resolve, reject) => {
			const video = document.createElement('video');
			video.src = 'video/video.webm';
			video.crossOrigin = 'anonymous';
			video.loop = true;
			video.muted = true;
			video.playsInline = true;

			// Timeout safety: if video doesn't load within 30s, resolve anyway
			const timeout = setTimeout(() => {
				console.warn('Video preload timeout; proceeding anyway');
				if (video._aspect === undefined) {
					video._aspect = 16 / 9; // fallback
				}
				clearAllListeners();
				resolve(video);
			}, 30000);

			const clearAllListeners = () => {
				video.removeEventListener('canplaythrough', onCanPlayThrough);
				video.removeEventListener('loadedmetadata', onLoadedMeta);
				video.removeEventListener('error', onError);
			};

			const onLoadedMeta = () => {
				video._aspect = video.videoWidth / video.videoHeight;
			};

			const onCanPlayThrough = () => {
				clearTimeout(timeout);
				clearAllListeners();
				resolve(video);
			};

			const onError = () => {
				clearTimeout(timeout);
				clearAllListeners();
				console.error('Video failed to load');
				reject(new Error('Video load failed'));
			};

			video.addEventListener('loadedmetadata', onLoadedMeta);
			video.addEventListener('canplaythrough', onCanPlayThrough);
			video.addEventListener('error', onError);

			video.load();
		});

		Promise.all([fontOpen, fontPlayfair, loadShadersPromise, loadVideoPromise]).then(([_, __, ___, video]) => {
			this.scroll = new Scroll();
			this.createVideoMesh(video);
			this.setupHover();
			this.resize();
			this.setupResize();

			this.render();
		});

		this.currentScroll = 0;
		this.previousScroll = 0;
		this.raycaster = new THREE.Raycaster();
		this.pointer = new THREE.Vector2();
		this.hovered = false; // track hover state for smooth transitions
	}

	async loadShaders() {
		this.vertexShader = await fetch('js/shaders/vertex.glsl').then(res => res.text());
		this.fragmentShader = await fetch('js/shaders/fragment.glsl').then(res => res.text());
		this.noiseShader = await fetch('js/shaders/noise.glsl').then(res => res.text());
	}



createVideoMesh(video) {
		// Start playing the video
		video.play();

		// Create video texture
		const texture = new THREE.VideoTexture(video);
		texture.minFilter = THREE.LinearFilter;
		texture.magFilter = THREE.LinearFilter;
		texture.format = THREE.RGBFormat;
		// no wrap mode needed; we handle uv transformation in shader


		// Geometry (will be scaled to cover viewport)
		let geometry = new THREE.PlaneGeometry(1, 1, 10, 10);

		// Shader material (clone of your existing shader)
		this.material = new THREE.ShaderMaterial({
			uniforms: {
				time: { value: 0 },
				uImage: { value: texture },
				hover: { value: new THREE.Vector2(0.5, 0.5) },
				hoverState: { value: 0 },
				uvScale: { value: new THREE.Vector2(1,1) },
				uvOffset: { value: new THREE.Vector2(0,0) },
				domnTexture: { value: new THREE.TextureLoader().load('img/ocean.jpg') }, // if you still need it
			},
			side: THREE.DoubleSide,
			vertexShader: this.vertexShader,
			fragmentShader: this.fragmentShader,
		});

	this.mesh = new THREE.Mesh(geometry, this.material);
	this.scene.add(this.mesh);

	// Make the plane fill the container initially
	this.updateMeshSize();
}

	updateMeshSize() {
		// Size the plane to exactly match the camera frustum at the mesh Z.
		// This uses world units so the plane fills the viewport without
		// stretching caused by mixing pixel sizes with camera projection.
		if (!this.mesh || !this.camera) return;

		const meshZ = this.mesh.position.z;
		const distance = Math.abs(this.camera.position.z - meshZ);
		// camera.fov is in degrees
		const vFOV = this.camera.fov * Math.PI / 180;
		const visibleHeight = 2 * Math.tan(vFOV / 2) * distance;
		const visibleWidth = visibleHeight * this.camera.aspect;

		this.mesh.scale.set(visibleWidth, visibleHeight, 1);
		this.mesh.position.set(0, 0, meshZ);
	
		// after sizing plane, adjust texture to cover
		if (this.mesh.material && this.mesh.material.uniforms && this.mesh.material.uniforms.uImage) {
			this.adjustTextureCover(this.mesh.material.uniforms.uImage.value);
		}
	}

	/*
	 * Adjust a video texture so it behaves like `object-fit: cover` inside
	 * the plane.  We compute the scale required to cover the plane based
	 * on the video aspect and the plane's aspect, then set repeat/offset.
	 */
	adjustTextureCover(texture) {
		if (!texture || !texture.image) return;
		const videoAspect = texture.image._aspect || (texture.image.videoWidth / texture.image.videoHeight || 1);
		const planeAspect = this.mesh.scale.x / this.mesh.scale.y;

		let scaleX = 1, scaleY = 1;
		let offX = 0, offY = 0;

		if (planeAspect > videoAspect) {
			// plane wider: zoom video by width
			scaleX = videoAspect / planeAspect; // <1
			offX = (1 - scaleX) / 2;
		} else {
			// plane taller: zoom video by height
			scaleY = planeAspect / videoAspect; // <1
			offY = (1 - scaleY) / 2;
		}

		// assign uniforms instead of manipulating texture wrap
		if (this.mesh.material.uniforms.uvScale) {
			this.mesh.material.uniforms.uvScale.value.set(scaleX, scaleY);
		}
		if (this.mesh.material.uniforms.uvOffset) {
			this.mesh.material.uniforms.uvOffset.value.set(offX, offY);
		}
	}

	setupHover() {
		window.addEventListener('pointermove', (event) => {
			this.pointer.x = (event.clientX / this.width) * 2 - 1;
			this.pointer.y = -(event.clientY / this.height) * 2 + 1;

			this.raycaster.setFromCamera(this.pointer, this.camera);
			const intersects = this.raycaster.intersectObject(this.mesh);

			const isIntersecting = intersects.length > 0;

			// Update hover UV if intersecting
			if (isIntersecting) {
				this.mesh.material.uniforms.hover.value = intersects[0].uv;
			}

			// Animate hoverState smoothly when entering/exiting
			if (isIntersecting !== this.hovered) {
				this.hovered = isIntersecting;
				gsap.to(this.mesh.material.uniforms.hoverState, {
					duration: 1,
					value: isIntersecting ? 1 : 0,
				});
			}
		});
	}


	setupResize() {
		window.addEventListener('resize', this.resize.bind(this));
	}

	resize() {
		this.width = this.container.offsetWidth;
		this.height = this.container.offsetHeight;
		this.renderer.setSize(this.width, this.height);

		this.camera.aspect = this.width / this.height;
		this.camera.updateProjectionMatrix();

		if (this.mesh) {
			this.updateMeshSize();
		}
	}
render() {
	this.time += 0.05 / 2;

	this.scroll.render();
	this.previousScroll = this.currentScroll;
	this.currentScroll = this.scroll.scrollToRender;

	// Update shader time uniform
	if (this.mesh) {
		this.mesh.material.uniforms.time.value = this.time;
		// keep cover adjustments in case aspect or plane changed
		if (this.mesh.material.uniforms.uImage) {
			this.adjustTextureCover(this.mesh.material.uniforms.uImage.value);
		}
	}
	// no per-frame target sync — mesh simply fills container

	this.renderer.render(this.scene, this.camera);
	window.requestAnimationFrame(this.render.bind(this));
}
}

// Sketch is exported; instantiate from HTML (index.html) so callers
// can pass a `targetEl`. Removed automatic instantiation.