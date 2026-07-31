import type { ComponentProps } from 'react';
import ReceptionTopBarBase from './ReceptionTopBarBase';

type ReceptionTopBarProps = ComponentProps<typeof ReceptionTopBarBase>;

export default function ReceptionTopBar(props: ReceptionTopBarProps) {
  return <ReceptionTopBarBase {...props} />;
}
