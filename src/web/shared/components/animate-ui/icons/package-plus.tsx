'use client';

import { motion, type Variants } from 'motion/react';

import {
  getVariants,
  useAnimateIconContext,
  IconWrapper,
  type IconProps,
} from '@animate-ui/react/icons';

// The lucide "package-plus" glyph, animated in the same way as the animate-ui registry icons
type PackagePlusProps = IconProps<keyof typeof animations>;

const animations = {
  default: {
    box: {},
    plus: { initial: { rotate: 0 }, animate: { rotate: [0, 90], transition: { duration: 0.5, ease: 'easeInOut' } } },
  } satisfies Record<string, Variants>,
} as const;

function IconComponent({ size, ...props }: PackagePlusProps) {
  const { controls } = useAnimateIconContext();
  const variants = getVariants(animations);

  return (
    <motion.svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <motion.path
        d="M12 22V12"
        variants={variants.box}
        initial="initial"
        animate={controls}
      />
      <motion.path
        d="M16 17h6"
        variants={variants.plus}
        initial="initial"
        animate={controls}
      />
      <motion.path
        d="M19 14v6"
        variants={variants.plus}
        initial="initial"
        animate={controls}
      />
      <motion.path
        d="M21 10.535V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.729l7 4a2 2 0 0 0 2 .001l1.675-.955"
        variants={variants.box}
        initial="initial"
        animate={controls}
      />
      <motion.path
        d="M3.29 7 12 12l8.71-5"
        variants={variants.box}
        initial="initial"
        animate={controls}
      />
      <motion.path
        d="m7.5 4.27 8.997 5.148"
        variants={variants.box}
        initial="initial"
        animate={controls}
      />
    </motion.svg>
  );
}

function PackagePlus(props: PackagePlusProps) {
  return <IconWrapper icon={IconComponent} {...props} />;
}

export {
  animations,
  PackagePlus,
  PackagePlus as PackagePlusIcon,
  type PackagePlusProps,
  type PackagePlusProps as PackagePlusIconProps,
};
