import { TextField, type TextFieldProps } from '../TextField';

export type NumberFieldProps = Omit<TextFieldProps, 'mono' | 'inputMode'>;

export function NumberField(props: NumberFieldProps) {
  return <TextField {...props} mono inputMode="decimal" style={{ textAlign: 'right', ...props.style }} />;
}
