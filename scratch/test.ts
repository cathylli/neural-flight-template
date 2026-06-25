import * as THREE from "three";
import { setup } from "../src/lib/experiences/circuit3/scene.ts";

// Mock document for Node environment
(global as any).document = {
    createElement: (tag: string) => {
        if (tag === "canvas") {
            return {
                width: 128,
                height: 256,
                getContext: () => ({
                    fillRect: () => { },
                    fillText: () => { },
                })
            };
        }
        return {};
    }
};

