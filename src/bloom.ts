import { NS } from "@ns"
import * as THREE from "three"
import { BloomEffect, EffectComposer, RenderPass } from "postprocessing"

export async function main(ns: NS): Promise<void> {
   //const doc: Document = eval("document")

   // Get the HTML document's body element
   const body = document.querySelector("body")

   // Create a renderer
   const renderer = new THREE.WebGLRenderer()

   // Set the renderer dimensions to match the screen
   renderer.setSize(window.innerWidth, window.innerHeight)

   // Add the renderer to the HTML document's body
   if (body) body.appendChild(renderer.domElement)

   // Initialize a scene and camera
   const scene = new THREE.Scene()
   const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
   )
   camera.position.z = 5

   // Add some geometry to the scene (a cube)
   const geometry = new THREE.BoxGeometry()
   const material = new THREE.MeshBasicMaterial({ color: 0xffffff })
   const cube = new THREE.Mesh(geometry, material)
   scene.add(cube)

   // Create an effect composer
   const composer = new EffectComposer(renderer)

   // Add a render pass to the effect composer
   const renderPass = new RenderPass(scene, camera)
   composer.addPass(renderPass)

   // Add a bloom effect to the effect composer
   const bloomEffect = new BloomEffect({
      luminanceThreshold: 0.9,
      luminanceSmoothing: 0.75,
      intensity: 2,
   })
   composer.addPass(bloomEffect)

   // Animate the cube in the render loop
   function animate() {
      requestAnimationFrame(animate)
      cube.rotation.x += 0.01
      cube.rotation.y += 0.01
      composer.render()
   }
   animate()
}
