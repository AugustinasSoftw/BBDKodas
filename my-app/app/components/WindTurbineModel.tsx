"use client";

import React, { useEffect, Suspense, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import {
  OrbitControls,
  Environment,
  useGLTF,
  Html,
  Center,
  useAnimations,
} from "@react-three/drei";
import * as THREE from "three";

function Turbine({ angle }: { angle: number }) {
  // 1. Įkrauname visą modelį
  const { scene, animations } = useGLTF("/models/turbine.glb");
  const { actions } = useAnimations(animations, scene);

  useEffect(() => {
    // 2. STOP: Sustabdome visas vidines animacijas (kad jėgainė pati nesivartytų)
    if (actions) {
      Object.values(actions).forEach((action) => action?.stop());
    }

    // Nustatome pradinę poziciją, kad jėgainė stovėtų tiesiai
    scene.rotation.set(0, 0, 0);
  }, [scene, actions]);

  useFrame(() => {
    // 3. SUKAME VISĄ MODELĮ
    const targetRad = THREE.MathUtils.degToRad(angle);

    // Ši eilutė suka visą tavo .glb failą aplink Y ašį (horizontaliai)
    scene.rotation.y = THREE.MathUtils.lerp(scene.rotation.y, targetRad, 0.1);

    // Užrakiname kitas ašis, kad modelis nevirstų pirmyn/atgal
    scene.rotation.x = 0;
    scene.rotation.z = 0;
  });

  return <primitive object={scene} scale={2} />;
}

export default function WindTurbineScene({ angle }: { angle: number }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return <div className="h-[500px] bg-slate-950" />;

  return (
    <div className="w-full h-[500px] bg-slate-950 rounded-xl overflow-hidden border border-slate-800">
      <Canvas camera={{ position: [55, 55, 55], fov: 35 }}>
        <ambientLight intensity={1.5} />
        <pointLight position={[10, 10, 10]} intensity={1} />
        <Environment preset="city" />

        <Suspense
          fallback={
            <Html center className="text-cyan-400">
              KRAUNAMA...
            </Html>
          }
        >
          {/* Šis komponentas VISADA pastatys modelį į ekrano vidurį */}
          <Center top>
            <Turbine angle={angle} />
          </Center>
        </Suspense>

        <OrbitControls
          enablePan={false}
          minDistance={15}
          maxDistance={70}
          // PAKEISK ŠIĄ EILUTĘ:
          // Jei jėgainė aukšta, padidink 6 iki 10 arba 12, kol kamera
          // fokusuosis tiesiai į sparnų centrą.
          target={[0, 20, 0]}
          makeDefault
        />
        <gridHelper args={[100, 50, 0x444444, 0x222222]} />
      </Canvas>
    </div>
  );
}
