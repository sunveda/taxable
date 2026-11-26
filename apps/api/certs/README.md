# Amazon RDS CA certificates

`rds-ap-southeast-2-bundle.pem` holds the public Amazon RDS root CAs for Sydney (RSA2048 G1,
RSA4096 G1, ECC384 G1; valid until 2061 and 2121). The Lambda build copies it next to the
bundle, and the API verifies the Aurora server certificate against it.

Source: https://truststore.pki.rds.amazonaws.com/ap-southeast-2/ap-southeast-2-bundle.pem
([AWS docs](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/UsingWithRDS.SSL.html)).
If the database moves to another region, replace it with that region's bundle.
