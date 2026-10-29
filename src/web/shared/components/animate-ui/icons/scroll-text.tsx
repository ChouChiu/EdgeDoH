'use client';

import { motion, type Variants } from 'motion/react';

import {
  getVariants,
  useAnimateIconContext,
  IconWrapper,
  type IconProps,
} from '@animate-ui/react/icons';

// The lucide "scroll-text" glyph, animated in the same way as the animate-ui registry icons
type ScrollTextProps = IconProps<keyof typeof animations>;

const animations = {
  default: {
    body: {},
    line1: { initial: { pathLength: 1, opacity: 1 }, animate: { pathLength: [0, 1], opacity: [0, 1], transition: { duration: 0.4, ease: 'easeInOut', delay: 0 } } },
    line2: { initial: { pathLength: 1, opacity: 1 }, animate: { pathLength: [0, 1], opacity: [0, 1], transition: { duration: 0.4, ease: 'easeInOut', delay: 0.15 } } },
  } satisfies Record<string, Variants>,
} as const;

function IconComponent({ size, ...props }: ScrollTextProps) {
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
        d="M15 12h-5"
        variants={variants.line2}
        initial="initial"
        animate={controls}
      />
      <motion.path
        d="M15 8h-5"
        variants={variants.line1}
        initial="initial"
        animate={controls}
      />
      <motion.path
        d="M19 17V5a2 2 0 0 0-2-2H4"
        variants={variants.body}
        initial="initial"
        animate={controls}
      />
      <motion.path
        d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"
        variants={variants.body}
        initial="initial"
        animate={controls}
      />
    </motion.svg>
  );
}

function ScrollText(props: ScrollTextProps) {
  return <IconWrapper icon={IconComponent} {...props} />;
}

export {
  animations,
  ScrollText,
  ScrollText as ScrollTextIcon,
  type ScrollTextProps,
  type ScrollTextProps as ScrollTextIconProps,
};
