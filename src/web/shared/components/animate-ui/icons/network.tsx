'use client';

import { motion, type Variants } from 'motion/react';

import {
  getVariants,
  useAnimateIconContext,
  IconWrapper,
  type IconProps,
} from '@animate-ui/react/icons';

// The lucide "network" glyph, animated in the same way as the animate-ui registry icons
type NetworkProps = IconProps<keyof typeof animations>;

const animations = {
  default: {
    top: { initial: { y: 0 }, animate: { y: [0, -2, 0], transition: { duration: 0.5, ease: 'easeInOut' } } },
    left: { initial: { y: 0 }, animate: { y: [0, 2, 0], transition: { duration: 0.5, ease: 'easeInOut', delay: 0.1 } } },
    right: { initial: { y: 0 }, animate: { y: [0, 2, 0], transition: { duration: 0.5, ease: 'easeInOut', delay: 0.2 } } },
    wire: { initial: { pathLength: 1, opacity: 1 }, animate: { pathLength: [0, 1], opacity: [0, 1], transition: { duration: 0.5, ease: 'easeInOut' } } },
  } satisfies Record<string, Variants>,
} as const;

function IconComponent({ size, ...props }: NetworkProps) {
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
      <motion.rect
        x="16" y="16" width="6" height="6" rx="1"
        variants={variants.right}
        initial="initial"
        animate={controls}
      />
      <motion.rect
        x="2" y="16" width="6" height="6" rx="1"
        variants={variants.left}
        initial="initial"
        animate={controls}
      />
      <motion.rect
        x="9" y="2" width="6" height="6" rx="1"
        variants={variants.top}
        initial="initial"
        animate={controls}
      />
      <motion.path
        d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"
        variants={variants.wire}
        initial="initial"
        animate={controls}
      />
      <motion.path
        d="M12 12V8"
        variants={variants.wire}
        initial="initial"
        animate={controls}
      />
    </motion.svg>
  );
}

function Network(props: NetworkProps) {
  return <IconWrapper icon={IconComponent} {...props} />;
}

export {
  animations,
  Network,
  Network as NetworkIcon,
  type NetworkProps,
  type NetworkProps as NetworkIconProps,
};
