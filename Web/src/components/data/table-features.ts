import {
  type ColumnDef,
  columnVisibilityFeature,
  createColumnHelper,
  type RowData,
  tableFeatures,
} from '@tanstack/react-table'

/** Métadonnées de colonne : classes, libellé du menu Colonnes, colonne masquable ou non. */
export interface ColumnMeta {
  className?: string
  headerClassName?: string
  /** Libellé dans le menu « Colonnes » (sinon l'en-tête s'il est textuel). */
  label?: string
  /** false : colonne toujours visible (identité de la ligne). */
  hideable?: boolean
}

export const dataTableFeatures = tableFeatures({ columnVisibilityFeature, columnMeta: {} as ColumnMeta })
export type DataTableFeatures = typeof dataTableFeatures
export type DataColumn<T extends RowData> = ColumnDef<DataTableFeatures, T, any> // eslint-disable-line @typescript-eslint/no-explicit-any
export const columnHelper = <T extends RowData>() => createColumnHelper<DataTableFeatures, T>()
