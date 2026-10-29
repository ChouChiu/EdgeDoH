'use client';

import { motion, type Variants } from 'motion/react';

import {
  getVariants,
  useAnimateIconContext,
  IconWrapper,
  type IconProps,
} from '@animate-ui/react/icons';

// The lucide "flask-conical" glyph, animated in the same way as the animate-ui registry icons
type FlaskConicalProps = IconProps<keyof typeof animations>;

const animations = {
  default: {
    group: { initial: { rotate: 0 }, animate: { rotate: [0, -10, 10, -5.0, 0], transition: { duration: 0.6, ease: 'easeInOut' } } },
    liquid: { initial: { y: 0 }, animate: { y: [0, -1.5, 0], transition: { duration: 0.5, ease: 'easeInOut' } } },
  } satisfies Record<string, Variants>,
} as const;

function IconComponent({ size, ...props }: FlaskConicalProps) {
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
      variants={variants.group}
      initial="initial"
      animate={controls}
      {...props}
    >
      <motion.path
        d="M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2"
      />
      <motion.path
        d="M6.453 15h11.094"
        variants={variants.liquid}
        initial="initial"
        animate={controls}
      />
      <motion.path
        d="M8.5 2h7"
      />
    </motion.svg>
  );
}

function FlaskConical(props: FlaskConicalProps) {
  return <IconWrapper icon={IconComponent} {...props} />;
}

export {
  animations,
  FlaskConical,
  FlaskConical as FlaskConicalIcon,
  type FlaskConicalProps,
  type FlaskConicalProps as FlaskConicalIconProps,
};
