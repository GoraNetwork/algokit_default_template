To build the stake the vesting app for production use

python build.py

followed by using beaker-ts to generate a client that's useful for webapp

npx tsx ./node_modules/beaker-ts/src/beaker.ts generate ./assets/vesting/artifacts/application.json ./assets/vesting/artifacts/

#This app was developed under beaker-pyteal==0.5.4 (before 1.0 came out :( )