import { DataTypes } from 'sequelize';

export default function defineContact(sequelize) {
  return sequelize.define('Contact', {
    id: { type: DataTypes.INTEGER, primaryKey: true },
    contact_type: DataTypes.STRING,
    department_name: { type: DataTypes.STRING, field: 'source_type' },
    name: DataTypes.STRING,
    company_name: DataTypes.STRING,
    email: DataTypes.STRING,
    dob: DataTypes.DATEONLY,
    mobile: DataTypes.STRING,
    city: DataTypes.STRING,
    cstate: DataTypes.STRING,
    updated_at: DataTypes.DATE,
  }, { tableName: 'contacts', timestamps: false });
}
