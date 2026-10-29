'use client';

import { motion, type Variants } from 'motion/react';

import {
  getVariants,
  useAnimateIconContext,
  IconWrapper,
  type IconProps,
} from '@animate-ui/react/icons';

// The lucide "power-off" glyph, animated in the same way as the animate-ui registry icons
type PowerOffProps = IconProps<keyof typeof animations>;

const animations = {
  default: {
    stem: { initial: { y: 0 }, animate: { y: [0, 2, 0], transition: { duration: 0.5, ease: 'easeInOut' } } },
    ring: {},
    slash: { initial: { pathLength: 1, opacity: 1 }, animate: { pathLength: [0, 1], opacity: [0, 1], transition: { duration: 0.5, ease: 'easeInOut' } } },
  } satisfies Record<string, Variants>,
} as const;

function IconComponent({ size, ...props }: PowerOffProps) {
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
        d="M18.36 6.64A9 9 0 0 1 20.77 15"
        variants={variants.ring}
        initial="initial"
        animate={controls}
      />
      <motion.path
        d="M6.16 6.16a9 9 0 1 0 12.68 12.68"
        variants={variants.ring}
        initial="initial"
        animate={controls}
      />
      <motion.path
        d="M12 2v4"
        variants={variants.stem}
        initial="initial"
        animate={controls}
      />
      <motion.path
        d="m2 2 20 20"
        variants={variants.slash}
        initial="initial"
        animate={controls}
      />
    </motion.svg>
  );
}

function PowerOff(props: PowerOffProps) {
  return <IconWrapper icon={IconComponent} {...props} />;
}

export {
  animations,
  PowerOff,
  PowerOff as PowerOffIcon,
  type PowerOffProps,
  type PowerOffProps as PowerOffIconProps,
};
