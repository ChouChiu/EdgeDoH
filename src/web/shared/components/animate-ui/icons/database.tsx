'use client';

import { motion, type Variants } from 'motion/react';

import {
  getVariants,
  useAnimateIconContext,
  IconWrapper,
  type IconProps,
} from '@animate-ui/react/icons';

// The lucide "database" glyph, animated in the same way as the animate-ui registry icons
type DatabaseProps = IconProps<keyof typeof animations>;

const animations = {
  default: {
    top: { initial: { y: 0 }, animate: { y: [0, -2, 0], transition: { duration: 0.5, ease: 'easeInOut' } } },
    middle: { initial: { y: 0 }, animate: { y: [0, -1, 0], transition: { duration: 0.5, ease: 'easeInOut' } } },
    base: {},
  } satisfies Record<string, Variants>,
} as const;

function IconComponent({ size, ...props }: DatabaseProps) {
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
      <motion.ellipse
        cx="12" cy="5" rx="9" ry="3"
        variants={variants.top}
        initial="initial"
        animate={controls}
      />
      <motion.path
        d="M3 5V19A9 3 0 0 0 21 19V5"
        variants={variants.base}
        initial="initial"
        animate={controls}
      />
      <motion.path
        d="M3 12A9 3 0 0 0 21 12"
        variants={variants.middle}
        initial="initial"
        animate={controls}
      />
    </motion.svg>
  );
}

function Database(props: DatabaseProps) {
  return <IconWrapper icon={IconComponent} {...props} />;
}

export {
  animations,
  Database,
  Database as DatabaseIcon,
  type DatabaseProps,
  type DatabaseProps as DatabaseIconProps,
};
