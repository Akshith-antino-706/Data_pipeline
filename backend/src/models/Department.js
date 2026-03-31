import { DataTypes } from 'sequelize';

export function definePrimaryDepartment(sequelize) {
  return sequelize.define('Department', {
    id: { type: DataTypes.INTEGER, primaryKey: true },
    name: DataTypes.STRING,
    did: DataTypes.INTEGER,
    email: DataTypes.STRING,
    status: DataTypes.STRING,
  }, { tableName: 'departments', timestamps: false });
}

export function defineChatsDepartment(sequelize) {
  return sequelize.define('Department', {
    id: { type: DataTypes.INTEGER, primaryKey: true },
    connection: DataTypes.STRING,
    name: DataTypes.STRING,
    description: DataTypes.STRING,
    created_at: DataTypes.DATE,
  }, { tableName: 'departments', timestamps: false });
}
