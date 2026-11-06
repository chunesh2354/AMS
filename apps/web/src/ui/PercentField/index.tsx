import { TextField, type TextFieldProps } from '../TextField';

export type PercentFieldProps = Omit<TextFieldProps, 'mono' | 'suffix' | 'inputMode'>;

export function PercentField(props: PercentFieldProps) {
  return <TextField {...props} mono suffix="%" inputMode="decimal" style={{ textAlign: 'right', ...props.style }} />;
}
