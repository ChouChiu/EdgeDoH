'use client';

import { motion, type Variants } from 'motion/react';

import {
  getVariants,
  useAnimateIconContext,
  IconWrapper,
  type IconProps,
} from '@animate-ui/react/icons';

// The lucide "shield-ban" glyph, animated in the same way as the animate-ui registry icons
type ShieldBanProps = IconProps<keyof typeof animations>;

const animations = {
  default: {
    shield: { initial: { scale: 1 }, animate: { scale: [1, 0.92, 1], transition: { duration: 0.5, ease: 'easeInOut' } } },
    slash: { initial: { pathLength: 1, opacity: 1 }, animate: { pathLength: [0, 1], opacity: [0, 1], transition: { duration: 0.5, ease: 'easeInOut' } } },
  } satisfies Record<string, Variants>,
} as const;

function IconComponent({ size, ...props }: ShieldBanProps) {
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
        d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"
        variants={variants.shield}
        initial="initial"
        animate={controls}
      />
      <motion.path
        d="m4.243 5.21 14.39 12.472"
        variants={variants.slash}
        initial="initial"
        animate={controls}
      />
    </motion.svg>
  );
}

function ShieldBan(props: ShieldBanProps) {
  return <IconWrapper icon={IconComponent} {...props} />;
}

export {
  animations,
  ShieldBan,
  ShieldBan as ShieldBanIcon,
  type ShieldBanProps,
  type ShieldBanProps as ShieldBanIconProps,
};
