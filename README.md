# SharedNodeEnv
A Node.js library designed to handle the creation of shared Environment Variables within multiple node applications 
running on the same server and sharing identical environmental variables that must be updated across all applications 
when changed. 

The library also allows for a application specific local environments variable file to be created that holds
environment variables that are specific to that application. If the local environments variable file contains any
entries that are identical to those in the shared file, the local variables will take precedence, effectively overriding
the shared variable with the local value.
 
## Installation

    npm install shared-node-env --save
    
## Use
Once installed, configured, and the environment files have been created the library is extremely easy to use.
Any environment variable defined in the shared or local .env files will be available as a property on the 'process.env'
object within your Node.js application. 

    var path = require('path');
    require('SharedNodeEnv')({
        sharedEnv: path.resolve(process.cwd(), '.env-shared'),
        localEnv: path.resolve(process.cwd(), '.env-local'),
        local: false
    });
    console.log('---------');
    console.log('Local Env');
    console.log('---------');
    console.log(process.env.SERVER_ID);
    
    var express = require('express');
    var favicon = require('serve-favicon');
    var logger = require('morgan');
    var cookieParser = require('cookie-parser');
    var bodyParser = require('body-parser');
    
##### IMPORTANT:
Make sure that the library is loaded, configured, and executed prior to anything else running in your Node.js application. 
This is to make sure that the global environment variables from your shared and local .env files are loaded into 
the 'process.env' object before they are used. 

Above is an example extracted from an Express.js web application. As you can see the library is loaded at the top of
the server.js file prior to the loading of the Express.js application or any other libraries that might depend on your
environment variables (PORT for example, for the web server).
    
    
## Configuration
The library can accept an optional configuration object that defines two optional configuration values.

#### Format

    {
        sharedEnv: 'path-to-shared-env-file/.env-shared', // default = undefined
        localEnv: 'path-to-local-env-file/.env-local',    // default = '.env-local'
        local: true                                       // default = true
    }
    
##### sharedEnv
Specifies the absolute path to the shared environment variables file.
The file must be named .env-shared and can be located anywhere on the server's file system so long as all Node.js applications
that utilize the shared environment variables can access it.
    
##### localEnv  
Specifies the absolute path to the local environment variables file. This file is meant to be application specific and 
should only be loaded by a single application. This value ONLY needs to be passed in if the local file is not located in the 
default location at the root of the Node.js application. No matter where the file is located it must be named .env-local.

##### local
Because the library assumes the existence of a local environments file, the ability to turn off local is permitted through
this configuration value. This is extremely useful when a shared environments file exists but a local does not for a 
specific application. When set to false the library will not process a local environments file even if one exists.

##### Notes:
Being that the two environment files will be opened and read by this library, it is important that the user account under
which the Node.js application is running has sufficient permissions to open and read them.

## Environment File Format (.env-shared, .env-local)
The individual environment files are simply comprised of a single array of key/value objects, in JSON format, 
representing each environment variable you wish to have added to the process.env object of your application. 
This of course allows you to add as many variables as needed to the file.
    
    [
        {
            "key": "SERVER_ID",
            "value": "123456"
        },
        {
            "key": "SYSTEM_TOKEN",
            "value": "qwe789asd"
        }
    ]
    
The library simply iterates over the array and processes each key/value pair adding it to the applications environment variable. 

    process.env[item.key] = item.value;

## Logic
The library first checks to see if a config object has been provided, if not the library assumes it is being used to 
manage a local environments file and will attempt to load .env-local from the root of the Node.js application.

If a configuration file is provided the library will check for each of the optional config keys and process each one in 
order starting with the shared env file and then the local. It is for this reason the local will overwrite values 
provided by the shared env file.

If local is disabled only the shared environment file will be processed.
    
## Potential Errors
If neither a local file nor a shared file is found the library will throw an error. This is due to the fact that the 
library is being executed within your Node.js application and expects to perform the task it was created for.

If either the shared or the local environments file being passed is not named correctly an error will be thrown.

If either the shared or the local environments file is empty an error will be thrown.

If either the shared or the local environments file is poorly formatted an error will be thrown.

## Secret Scanning

This repository is scanned for committed credentials by [gitleaks](https://github.com/gitleaks/gitleaks)
at two points.

**Locally, before each commit.** A `pre-commit` hook scans staged changes and
refuses the commit if it finds a secret. The hook lives in `.githooks/` and is
wired up automatically by the `prepare` script when you run `npm install`. To
enable it by hand:

    git config core.hooksPath .githooks

The hook needs gitleaks on your PATH (`brew install gitleaks`). If it is not
installed the hook prints a notice and lets the commit through, so a missing
tool never blocks work — CI still scans the push.

**In CI, on every push and pull request.** `.github/workflows/secret-scan.yml`
scans the full history, not just the diff, and fails the build on any finding.
This is the enforcement point; the hook is only an early warning.

#### Handling a finding

If it is a real credential, remove it and **rotate it**. Rotate even if it was
never pushed — it already exists in your shell history and on disk.

If it is a false positive, add it to the `regexes` list in `.gitleaks.toml`
with a comment explaining why it is not a credential. Prefer a narrow value
match over excluding a whole path; broad path exclusions are how scanners
quietly stop finding things.

To bypass the local hook deliberately:

    git commit --no-verify

CI cannot be bypassed.

#### Running a scan by hand

    npm run scan