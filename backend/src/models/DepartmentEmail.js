import { DataTypes } from 'sequelize';

export default function defineDepartmentEmail(sequelize) {
  return sequelize.define('DepartmentEmail', {
    id: { type: DataTypes.INTEGER, primaryKey: true },
    did: DataTypes.INTEGER,
    email: DataTypes.STRING,
    status: DataTypes.STRING,
  }, { tableName: 'department_emails', timestamps: false });
}
