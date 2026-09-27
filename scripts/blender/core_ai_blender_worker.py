import argparse
import math
import os
import bpy
from mathutils import Vector


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for block in list(datablocks):
            if block.users == 0:
                datablocks.remove(block)


def material(name, color, roughness=0.55):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1.0)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (*color, 1.0)
        bsdf.inputs["Roughness"].default_value = roughness
    return mat


def add_box(name, location, scale, mat):
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    return obj


def add_camera(location, target=(0.0, 0.0, 1.0), lens=45):
    bpy.ops.object.camera_add(location=location)
    camera = bpy.context.object
    camera.data.lens = lens
    direction = Vector(target) - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = camera
    return camera


def add_lighting():
    bpy.ops.object.light_add(type="AREA", location=(4.0, -4.0, 6.0))
    key = bpy.context.object
    key.data.energy = 900
    key.data.shape = "DISK"
    key.data.size = 5.0

    bpy.ops.object.light_add(type="AREA", location=(-4.0, 2.0, 4.0))
    fill = bpy.context.object
    fill.data.energy = 500
    fill.data.size = 4.0

    bpy.ops.object.light_add(type="SUN", location=(0.0, 0.0, 6.0))
    sun = bpy.context.object
    sun.rotation_euler = (math.radians(25), math.radians(-20), math.radians(25))
    sun.data.energy = 1.5


def build_interior_test():
    floor_mat = material("Warm Floor", (0.38, 0.22, 0.12), 0.65)
    wall_mat = material("Warm Wall", (0.82, 0.76, 0.68), 0.8)
    sofa_mat = material("Sofa", (0.18, 0.24, 0.28), 0.6)
    table_mat = material("Table", (0.48, 0.28, 0.12), 0.5)

    add_box("Floor", (0, 0, -0.1), (4.5, 4.5, 0.1), floor_mat)
    add_box("BackWall", (0, 4.4, 2.0), (4.5, 0.1, 2.1), wall_mat)
    add_box("SideWall", (-4.4, 0, 2.0), (0.1, 4.5, 2.1), wall_mat)
    add_box("Sofa", (0.5, 1.2, 0.55), (1.8, 0.55, 0.55), sofa_mat)
    add_box("SofaBack", (0.5, 1.65, 1.25), (1.8, 0.12, 0.75), sofa_mat)
    add_box("CoffeeTable", (0.5, -0.5, 0.45), (1.1, 0.7, 0.12), table_mat)


def build_fashion_test():
    body_mat = material("Mannequin", (0.72, 0.66, 0.58), 0.7)
    cloth_mat = material("Garment", (0.12, 0.28, 0.48), 0.45)
    floor_mat = material("Studio Floor", (0.18, 0.18, 0.18), 0.85)

    add_box("Floor", (0, 0, -0.08), (3.5, 3.5, 0.08), floor_mat)

    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, location=(0, 0, 2.7), scale=(0.48, 0.48, 0.58))
    head = bpy.context.object
    head.name = "Head"
    head.data.materials.append(body_mat)

    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.62, depth=2.2, location=(0, 0, 1.45))
    torso = bpy.context.object
    torso.name = "MannequinTorso"
    torso.scale.x = 0.78
    torso.data.materials.append(body_mat)

    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.74, depth=1.45, location=(0, 0, 1.55))
    garment = bpy.context.object
    garment.name = "Garment"
    garment.scale.x = 0.88
    garment.data.materials.append(cloth_mat)


def configure_scene(width, height):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.world.color = (0.055, 0.055, 0.055)


def export_glb(path):
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_apply=True,
    )


def render_preview(path, scene_type):
    if scene_type == "fashion":
        add_camera((5.5, -6.5, 3.3), target=(0, 0, 1.5), lens=58)
    else:
        add_camera((7.5, -8.0, 5.8), target=(0, 0.6, 1.0), lens=45)
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--scene-type", choices=["interior", "fashion"], default="interior")
    parser.add_argument("--width", type=int, default=512)
    parser.add_argument("--height", type=int, default=512)
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    clear_scene()
    configure_scene(max(256, min(args.width, 1024)), max(256, min(args.height, 1024)))

    if args.scene_type == "fashion":
        build_fashion_test()
    else:
        build_interior_test()

    add_lighting()

    blend_path = os.path.join(args.output_dir, "scene.blend")
    glb_path = os.path.join(args.output_dir, "scene.glb")
    preview_path = os.path.join(args.output_dir, "preview.png")

    export_glb(glb_path)
    render_preview(preview_path, args.scene_type)
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)

    print("CORE_AI_BLEND=" + blend_path)
    print("CORE_AI_GLB=" + glb_path)
    print("CORE_AI_PREVIEW=" + preview_path)


if __name__ == "__main__":
    main()
