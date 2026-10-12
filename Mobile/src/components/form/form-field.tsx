import { type Control, Controller, type FieldPath, type FieldValues } from 'react-hook-form'
import { type TextInputProps } from 'react-native'

import { TextField } from '@/components/ui/text-field'

/** Champ texte relié à react-hook-form (valeur, blur, erreur sous le champ). */
export function FormField<T extends FieldValues>({
  control,
  name,
  label,
  hint,
  secure,
  ...input
}: TextInputProps & { control: Control<T>; name: FieldPath<T>; label: string; hint?: string; secure?: boolean }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <TextField
          {...input}
          label={label}
          hint={hint}
          secure={secure}
          value={field.value as string}
          onChangeText={field.onChange}
          onBlur={field.onBlur}
          error={fieldState.error?.message}
        />
      )}
    />
  )
}
