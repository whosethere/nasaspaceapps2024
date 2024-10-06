let scene, camera, renderer, mars, controls, quakeEffect, atmosphereMesh, insightMarker;
const marsRotationSpeed = Math.PI * 2 / (24 * 60 * 60);
let isQuaking = false;
let quakeStartTime = 0;
const quakeDuration = 5000;
let seismicData = [];
let minTime, maxTime;

// Zmieniamy współrzędne InSight na stałe globalne
const INSIGHT_LATITUDE = 4.5024 * (Math.PI / 180);
const INSIGHT_LONGITUDE = 135.6234 * (Math.PI / 180);

async function loadCSVData() {
    try {
        const response = await fetch('XB.ELYSE.02.BHV.2022-01-02HR04_evid0006.csv');
        const data = await response.text();
        const rows = data.split('\n').slice(1);
        return rows.map(row => {
            const [time, relTime, velocity] = row.split(',');
            return {
                time: new Date(time),
                relTime: parseFloat(relTime),
                velocity: parseFloat(velocity)
            };
        }).filter(item => !isNaN(item.relTime) && !isNaN(item.velocity));
    } catch (error) {
        console.error('Błąd podczas ładowania danych CSV:', error);
        return [];
    }
}

async function init() {
    seismicData = await loadCSVData();
    if (seismicData.length > 0) {
        minTime = Math.min(...seismicData.map(d => d.time.getTime()));
        maxTime = Math.max(...seismicData.map(d => d.time.getTime()));

        const slider = document.getElementById('daySlider');
        slider.min = 0;
        slider.max = seismicData.length - 1;
        slider.value = 0;
    } else {
        console.error('Brak danych sejsmicznych');
        return;
    }

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 0, 5);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    document.body.appendChild(renderer.domElement);

    const loader = new THREE.GLTFLoader();
    loader.load('24881_Mars_1_6792.gltf', function(gltf) {
        mars = gltf.scene;
        scene.add(mars);
        
        const box = new THREE.Box3().setFromObject(mars);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = 2 / maxDim;
        mars.scale.set(scale, scale, scale);
        mars.position.sub(center.multiplyScalar(scale));

        // Obracamy model tak, aby InSight było widoczne z przodu
        mars.rotation.y = -INSIGHT_LONGITUDE;

        createAtmosphere();
        createInsightMarker();
        createQuakeEffect();
        document.getElementById('info').textContent = 'Model załadowany. Użyj suwaka do kontroli czasu.';
    }, undefined, function(error) {
        console.error('Błąd ładowania modelu:', error);
        document.getElementById('info').textContent = 'Błąd ładowania modelu. Sprawdź konsolę.';
    });

    const pointLight = new THREE.PointLight(0xffffff, 1.5, 100);
    pointLight.position.set(10, 10, 10);
    scene.add(pointLight);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    const slider = document.getElementById('daySlider');
    const dayDisplay = document.getElementById('dayDisplay');
    slider.addEventListener('input', function() {
        const index = parseInt(this.value);
        const currentData = seismicData[index];
        dayDisplay.textContent = `Czas: ${currentData.time.toISOString()}`;
        
        // Nie obracamy modelu Marsa
        checkForQuake(currentData.velocity);
        updateSeismicChart(index);
    });

    drawSeismicChart();

    window.addEventListener('resize', onWindowResize, false);

    animate();
}

function createAtmosphere() {
    const geometry = new THREE.SphereGeometry(1.02, 64, 64);
    const material = new THREE.MeshPhongMaterial({
        color: 0x0055ff,
        transparent: true,
        opacity: 0.1,
        side: THREE.DoubleSide
    });
    atmosphereMesh = new THREE.Mesh(geometry, material);
    scene.add(atmosphereMesh);
}

function createInsightMarker() {
    const radius = 1.025;  // Nieco większy niż promień Marsa, aby marker był widoczny

    const x = radius * Math.cos(INSIGHT_LATITUDE) * Math.cos(INSIGHT_LONGITUDE);
    const y = radius * Math.sin(INSIGHT_LATITUDE);
    const z = radius * Math.cos(INSIGHT_LATITUDE) * Math.sin(INSIGHT_LONGITUDE);

    const geometry = new THREE.SphereGeometry(0.02, 32, 32);  // Zwiększamy rozmiar markera
    const material = new THREE.MeshBasicMaterial({ color: 0xffff00 });  // Żółty kolor
    insightMarker = new THREE.Mesh(geometry, material);
    
    insightMarker.position.set(x, y, z);
    scene.add(insightMarker);

    // Dodajemy etykietę HTML
    const labelDiv = document.createElement('div');
    labelDiv.textContent = 'InSight';
    labelDiv.style.position = 'absolute';
    labelDiv.style.color = 'white';
    labelDiv.style.padding = '2px';
    labelDiv.style.backgroundColor = 'rgba(0,0,0,0.5)';
    labelDiv.style.fontSize = '12px';
    document.body.appendChild(labelDiv);

    // Funkcja do aktualizacji pozycji etykiety
    function updateLabel() {
        if (insightMarker) {
            const vector = insightMarker.position.clone();
            vector.project(camera);

            const widthHalf = window.innerWidth / 2;
            const heightHalf = window.innerHeight / 2;

            labelDiv.style.left = (vector.x * widthHalf + widthHalf) + 'px';
            labelDiv.style.top = (-vector.y * heightHalf + heightHalf) + 'px';
        }
    }

    // Dodajemy funkcję updateLabel do pętli animacji
    function animateWithLabel() {
        requestAnimationFrame(animateWithLabel);
        updateLabel();
    }
    animateWithLabel();
}

function createQuakeEffect() {
    const geometry = new THREE.SphereGeometry(1.025, 128, 128);
    const material = new THREE.ShaderMaterial({
        uniforms: {
            epicenter: { value: new THREE.Vector3() }, // Inicjalizujemy z wektorem zerowym
            quakeIntensity: { value: 0.0 },
            time: { value: 0.0 }
        },
        vertexShader: `
            uniform vec3 epicenter;
            uniform float quakeIntensity;
            uniform float time;
            varying float intensity;

            void main() {
                // Transformujemy pozycję do układu światowego
                vec4 worldPosition = modelMatrix * vec4(position, 1.0);

                // Obliczamy odległość w układzie światowym
                float distance = distance(normalize(worldPosition.xyz), normalize(epicenter));

                // Reszta kodu pozostaje bez zmian
                float waveEffect = sin(distance * 20.0 - time * 10.0) * 0.5 + 0.5;
                intensity = (1.0 - distance) * quakeIntensity * waveEffect;

                // Zastosowanie intensywności do pozycji
                vec3 newPosition = position + normal * intensity * 0.05;

                gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
            }
        `,
        fragmentShader: `
            varying float intensity;

            void main() {
                vec3 color = mix(vec3(1.0, 1.0, 0.0), vec3(1.0, 0.0, 0.0), intensity);
                gl_FragColor = vec4(color, intensity * 0.7);
            }
        `,
        transparent: true,
        side: THREE.DoubleSide
    });
    quakeEffect = new THREE.Mesh(geometry, material);
    quakeEffect.visible = false;
    scene.add(quakeEffect);
}


function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    drawSeismicChart();
}

function checkForQuake(velocity) {
    const threshold = 100; // Przykładowy próg, dostosuj według potrzeb
    if (Math.abs(velocity) > threshold) {
        if (!isQuaking) {
            startQuake(velocity);
        }
    } else {
        stopQuake();
    }
}

function startQuake(velocity) {
    isQuaking = true;
    quakeStartTime = Date.now();
    document.getElementById('quakeInfo').textContent = `Trzęsienie Marsa! Siła: ${velocity.toFixed(2)}`;
    if (quakeEffect) {
        quakeEffect.visible = true;
        quakeEffect.material.uniforms.quakeIntensity.value = Math.min(Math.abs(velocity) / 1000, 1); // Normalizujemy intensywność
    }
}

function stopQuake() {
    if (isQuaking) {
        isQuaking = false;
        document.getElementById('quakeInfo').textContent = '';
        if (mars) {
            mars.position.set(0, 0, 0);
        }
        if (quakeEffect) {
            quakeEffect.visible = false;
            quakeEffect.material.uniforms.quakeIntensity.value = 0.0;
        }
    }
}

function updateQuake() {
    if (!isQuaking) return;

    const elapsedTime = Date.now() - quakeStartTime;
    const intensity = Math.sin(elapsedTime * 0.002) * 0.5 + 0.5;
    if (mars) {
        mars.position.set(
            Math.random() * intensity * 0.01,
            Math.random() * intensity * 0.01,
            Math.random() * intensity * 0.01
        );
    }

    if (quakeEffect) {
        quakeEffect.material.uniforms.quakeIntensity.value = Math.min(intensity, 1.0);
        quakeEffect.material.uniforms.time.value = elapsedTime * 0.002;
    }
}

function drawSeismicChart() {
    const canvas = document.getElementById('seismicChart');
    const ctx = canvas.getContext('2d');
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath();
    ctx.moveTo(0, canvas.height / 2);

    const maxVelocity = Math.max(...seismicData.map(d => Math.abs(d.velocity)));

    for (let i = 0; i < seismicData.length; i++) {
        const x = (i / (seismicData.length - 1)) * canvas.width;
        const y = canvas.height / 2 - (seismicData[i].velocity / maxVelocity) * (canvas.height / 2);
        ctx.lineTo(x, y);
    }

    ctx.strokeStyle = 'red';
    ctx.lineWidth = 2;
    ctx.stroke();
}

function updateSeismicChart(currentIndex) {
    const canvas = document.getElementById('seismicChart');
    const ctx = canvas.getContext('2d');
    
    drawSeismicChart();

    const x = (currentIndex / (seismicData.length - 1)) * canvas.width;
    
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;
    ctx.stroke();
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    updateQuake();
    if (insightMarker && mars) {
        insightMarker.quaternion.copy(mars.quaternion);
    }
    if (quakeEffect && mars) {
        quakeEffect.quaternion.copy(mars.quaternion);

        // Pobieramy światową pozycję markera InSight
        var epicenterWorldPos = insightMarker.getWorldPosition(new THREE.Vector3());

        // Aktualizujemy uniform 'epicenter' w shaderze
        quakeEffect.material.uniforms.epicenter.value.copy(epicenterWorldPos);
    }
    renderer.render(scene, camera);
}


window.addEventListener('DOMContentLoaded', (event) => {
    init();
});
