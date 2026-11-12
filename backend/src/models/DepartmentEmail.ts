import { DataTypes } from 'sequelize';
import type { Sequelize, ModelStatic, Model } from 'sequelize';

export default function defineDepartmentEmail(sequelize: Sequelize): ModelStatic<Model> {
  return sequelize.define('DepartmentEmail', {
    id: { type: DataTypes.INTEGER, primaryKey: true },
    did: DataTypes.INTEGER,
    email: DataTypes.STRING,
    status: DataTypes.STRING,
  }, { tableName: 'department_emails', timestamps: false });
}
