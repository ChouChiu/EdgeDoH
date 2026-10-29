'use client';

import { motion, type Variants } from 'motion/react';

import {
  getVariants,
  useAnimateIconContext,
  IconWrapper,
  type IconProps,
} from '@animate-ui/react/icons';

// The lucide "languages" glyph, animated in the same way as the animate-ui registry icons
type LanguagesProps = IconProps<keyof typeof animations>;

const animations = {
  default: {
    source: { initial: { rotate: 0 }, animate: { rotate: [0, -12, 12, -6.0, 0], transition: { duration: 0.6, ease: 'easeInOut' } } },
    letter: { initial: { pathLength: 1, opacity: 1 }, animate: { pathLength: [0, 1], opacity: [0, 1], transition: { duration: 0.4, ease: 'easeInOut', delay: 0 } } },
    bar: { initial: { pathLength: 1, opacity: 1 }, animate: { pathLength: [0, 1], opacity: [0, 1], transition: { duration: 0.4, ease: 'easeInOut', delay: 0.3 } } },
  } satisfies Record<string, Variants>,
} as const;

function IconComponent({ size, ...props }: LanguagesProps) {
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
        d="m5 8 6 6"
        variants={variants.source}
        initial="initial"
        animate={controls}
      />
      <motion.path
        d="m4 14 6-6 2-3"
        variants={variants.source}
        initial="initial"
        animate={controls}
      />
      <motion.path
        d="M2 5h12"
        variants={variants.source}
        initial="initial"
        animate={controls}
      />
      <motion.path
        d="M7 2h1"
        variants={variants.source}
        initial="initial"
        animate={controls}
      />
      <motion.path
        d="m22 22-5-10-5 10"
        variants={variants.letter}
        initial="initial"
        animate={controls}
      />
      <motion.path
        d="M14 18h6"
        variants={variants.bar}
        initial="initial"
        animate={controls}
      />
    </motion.svg>
  );
}

function Languages(props: LanguagesProps) {
  return <IconWrapper icon={IconComponent} {...props} />;
}

export {
  animations,
  Languages,
  Languages as LanguagesIcon,
  type LanguagesProps,
  type LanguagesProps as LanguagesIconProps,
};
