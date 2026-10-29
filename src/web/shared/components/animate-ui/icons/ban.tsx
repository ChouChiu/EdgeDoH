'use client';

import { motion, type Variants } from 'motion/react';

import {
  getVariants,
  useAnimateIconContext,
  IconWrapper,
  type IconProps,
} from '@animate-ui/react/icons';

// The lucide "ban" glyph, animated in the same way as the animate-ui registry icons
type BanProps = IconProps<keyof typeof animations>;

const animations = {
  default: {
    circle: { initial: { scale: 1 }, animate: { scale: [1, 0.92, 1], transition: { duration: 0.5, ease: 'easeInOut' } } },
    slash: { initial: { pathLength: 1, opacity: 1 }, animate: { pathLength: [0, 1], opacity: [0, 1], transition: { duration: 0.5, ease: 'easeInOut' } } },
  } satisfies Record<string, Variants>,
} as const;

function IconComponent({ size, ...props }: BanProps) {
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
      <motion.circle
        cx="12" cy="12" r="10"
        variants={variants.circle}
        initial="initial"
        animate={controls}
      />
      <motion.path
        d="M4.929 4.929 19.07 19.071"
        variants={variants.slash}
        initial="initial"
        animate={controls}
      />
    </motion.svg>
  );
}

function Ban(props: BanProps) {
  return <IconWrapper icon={IconComponent} {...props} />;
}

export {
  animations,
  Ban,
  Ban as BanIcon,
  type BanProps,
  type BanProps as BanIconProps,
};
