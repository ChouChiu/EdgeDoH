import { MotionGlobalConfig } from "motion/react";

// happy-dom cancels motion's Web Animations mid-flight, which surfaces as unhandled rejections; tests only need end states
MotionGlobalConfig.skipAnimations = true;
